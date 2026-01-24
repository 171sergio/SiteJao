/**
 * @module services/inadimplenteService
 * @description Serviço de operações para inadimplentes
 */

import { getSupabaseClient } from '../core/supabase.js';
import { PAYMENT_FEES, calculateNetValue } from '../logic/finance.js';

/**
 * Carrega clientes inadimplentes
 * @param {string} filterClient - Filtro por nome ou telefone
 * @returns {Promise<Array>}
 */
export async function loadUnpaidClients(filterClient = '') {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error('Supabase não configurado');
        return [];
    }

    try {
        // Primeiro, atualizar dias de atraso
        await updateUnpaidList();

        // Buscar inadimplentes com JOIN nas tabelas
        let query = supabaseClient
            .from('inadimplentes')
            .select(`
                *,
                clientes(nome, telefone),
                agendamentos(data_horario, servico, servicos(nome))
            `)
            .eq('status_cobranca', 'pendente')
            .gt('valor_restante', 0)
            .order('dias_atraso', { ascending: false });

        // Filtrar por cliente se especificado
        if (filterClient) {
            query = query.or(`clientes.nome.ilike.%${filterClient}%,clientes.telefone.ilike.%${filterClient}%`);
        }

        const { data, error } = await query;

        if (error) throw error;

        return data || [];
    } catch (error) {
        console.error('Erro ao carregar inadimplentes:', error);
        throw error;
    }
}

/**
 * Atualiza dias de atraso de todos os inadimplentes
 * @returns {Promise<void>}
 */
export async function updateUnpaidList() {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) return;

    try {
        const { data: inadimplentes, error } = await supabaseClient
            .from('inadimplentes')
            .select(`
                *,
                agendamentos(data_horario)
            `)
            .neq('status_cobranca', 'quitado');

        if (error) throw error;

        const hoje = new Date();

        for (const inadimplente of inadimplentes || []) {
            let dataServico;
            if (inadimplente.agendamentos?.data_horario) {
                dataServico = new Date(inadimplente.agendamentos.data_horario);
            } else if (inadimplente.data_vencimento) {
                dataServico = new Date(inadimplente.data_vencimento + 'T00:00:00');
            } else {
                continue;
            }

            const diasAtraso = Math.max(0, Math.floor((hoje - dataServico) / (1000 * 60 * 60 * 24)));

            if (diasAtraso !== inadimplente.dias_atraso) {
                await supabaseClient
                    .from('inadimplentes')
                    .update({ dias_atraso: diasAtraso })
                    .eq('id', inadimplente.id);
            }
        }
    } catch (error) {
        console.error('Erro ao atualizar lista de inadimplentes:', error);
    }
}

/**
 * Cria registro de inadimplente a partir de agendamento
 * @param {Object} params - Parâmetros
 * @returns {Promise<Object|null>}
 */
export async function createInadimplenteFromAppointment(params) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error('Supabase não configurado');
        return null;
    }

    try {
        const inadimplenteData = {
            agendamento_id: params.agendamentoId,
            cliente_id: params.clienteId,
            telefone: params.telefone || '',
            nome_cliente: params.nomeCliente,
            servico: params.servico,
            valor_devido: params.valorDevido,
            valor_pago: 0,
            valor_restante: params.valorDevido,
            data_vencimento: params.dataVencimento,
            status_cobranca: 'pendente',
            observacoes_cobranca: params.observacoes || 'Serviço não pago'
        };

        const { data: inadimplente, error } = await supabaseClient
            .from('inadimplentes')
            .insert([inadimplenteData])
            .select()
            .single();

        if (error) {
            console.error('Erro ao criar inadimplente:', error);
            throw error;
        }

        // Registrar log de auditoria
        await supabaseClient
            .from('logs_sistema')
            .insert([{
                tipo: 'INADIMPLENTE_CRIADO',
                origem: 'sistema',
                mensagem: `Cliente ${params.nomeCliente} marcado como inadimplente - R$ ${params.valorDevido.toFixed(2)}`,
                detalhes: {
                    agendamento_id: params.agendamentoId,
                    cliente_id: params.clienteId,
                    valor: params.valorDevido,
                    servico: params.servico,
                    data_criacao: new Date().toISOString()
                }
            }]);

        console.log('Inadimplente criado:', inadimplente);
        return inadimplente;

    } catch (error) {
        console.error('Erro ao criar registro de inadimplente:', error);
        throw error;
    }
}

/**
 * Marca pagamento como pago (usando ID da inadimplência)
 * @param {number} inadimplenteId - ID da inadimplência
 * @param {string} paymentMethod - Método de pagamento
 * @returns {Promise<boolean>}
 */
export async function markAsPaidByInadimplente(inadimplenteId, paymentMethod) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    try {
        // Buscar dados da inadimplência
        const { data: inadimplente, error: fetchError } = await supabaseClient
            .from('inadimplentes')
            .select('*, agendamentos(servico, preco_cobrado, nome_cliente)')
            .eq('id', inadimplenteId)
            .single();

        if (fetchError) throw fetchError;

        const valor = parseFloat(inadimplente.valor_devido) || 0;
        const valorLiquido = calculateNetValue(valor, paymentMethod);

        // Atualizar status do inadimplente para quitado
        const { error: inadimplenteError } = await supabaseClient
            .from('inadimplentes')
            .update({
                status_cobranca: 'quitado',
                valor_pago: valor,
                valor_restante: 0
            })
            .eq('id', inadimplenteId);

        if (inadimplenteError) throw inadimplenteError;

        // Se tiver agendamento vinculado, atualizar status_pagamento
        if (inadimplente.agendamento_id) {
            await supabaseClient
                .from('agendamentos')
                .update({
                    status_pagamento: 'pago',
                    forma_pagamento: paymentMethod,
                    valor_pago: valor,
                    valor_liquido: valorLiquido,
                    taxa_aplicada: PAYMENT_FEES[paymentMethod] || 0
                })
                .eq('id', inadimplente.agendamento_id);

            // Criar registro de pagamento
            await supabaseClient
                .from('pagamentos')
                .insert({
                    agendamento_id: inadimplente.agendamento_id,
                    cliente_id: inadimplente.cliente_id,
                    valor_pago: valor,
                    forma_pagamento: paymentMethod,
                    status: 'pago',
                    data_pagamento: new Date().toISOString()
                });

            // Registrar log de auditoria
            await supabaseClient
                .from('logs_sistema')
                .insert([{
                    tipo: 'INADIMPLENTE_QUITADO',
                    origem: 'sistema',
                    mensagem: `Inadimplência quitada via ${paymentMethod} - R$ ${valor.toFixed(2)}`,
                    detalhes: {
                        inadimplente_id: inadimplenteId,
                        agendamento_id: inadimplente.agendamento_id,
                        cliente_id: inadimplente.cliente_id,
                        valor: valor,
                        valor_liquido: valorLiquido,
                        forma_pagamento: paymentMethod,
                        data_quitacao: new Date().toISOString()
                    }
                }]);
        }

        return true;
    } catch (error) {
        console.error('Erro ao confirmar pagamento:', error);
        throw error;
    }
}

/**
 * Exclui um registro de inadimplência
 * @param {number} id - ID da inadimplência
 * @returns {Promise<boolean>}
 */
export async function deleteUnpaidClient(id) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const { error } = await supabaseClient
        .from('inadimplentes')
        .delete()
        .eq('id', id);

    if (error) throw error;

    return true;
}

/**
 * Busca dados de uma inadimplência por ID
 * @param {number} id - ID da inadimplência
 * @returns {Promise<Object>}
 */
export async function getInadimplenteById(id) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const { data, error } = await supabaseClient
        .from('inadimplentes')
        .select('*')
        .eq('id', id)
        .single();

    if (error) throw error;

    return data;
}

/**
 * Adiciona cliente inadimplente (manual, sem agendamento)
 * @param {Object} params - Parâmetros
 * @returns {Promise<Object>}
 */
export async function addUnpaidClient(params) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const inadimplenteData = {
        cliente_id: params.clienteId || null,
        telefone: params.telefone || '',
        nome_cliente: params.nomeCliente,
        servico: params.servico,
        valor_devido: params.valorDevido,
        valor_pago: 0,
        valor_restante: params.valorDevido,
        data_vencimento: params.dataVencimento,
        status_cobranca: 'pendente',
        observacoes_cobranca: params.observacoes || ''
    };

    // Se tem ID de agendamento, vincular
    if (params.agendamentoId) {
        inadimplenteData.agendamento_id = params.agendamentoId;
    }

    const { data, error } = await supabaseClient
        .from('inadimplentes')
        .insert([inadimplenteData])
        .select()
        .single();

    if (error) throw error;

    return data;
}

/**
 * Atualiza dados de uma inadimplência
 * @param {number} id - ID da inadimplência
 * @param {Object} data - Dados a atualizar
 * @returns {Promise<Object>}
 */
export async function updateInadimplente(id, data) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const { data: result, error } = await supabaseClient
        .from('inadimplentes')
        .update(data)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;

    return result;
}

/**
 * Registra tentativa de contato com cliente inadimplente
 * @param {number} agendamentoId - ID do agendamento
 * @returns {Promise<void>}
 */
export async function registerContactAttempt(agendamentoId) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient || !agendamentoId) return;

    try {
        const { data: inadimplente } = await supabaseClient
            .from('inadimplentes')
            .select('tentativas_contato')
            .eq('agendamento_id', agendamentoId)
            .single();

        await supabaseClient
            .from('inadimplentes')
            .update({
                tentativas_contato: (inadimplente?.tentativas_contato || 0) + 1,
                ultimo_contato: new Date().toISOString()
            })
            .eq('agendamento_id', agendamentoId);
    } catch (error) {
        console.error('Erro ao registrar contato:', error);
    }
}
