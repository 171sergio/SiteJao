/**
 * @module services/agendamentoService
 * @description Serviço de operações para agendamentos
 */

import { getSupabaseClient } from '../core/supabase.js';
import {
    getAppointments, setAppointments,
    getTodayAppointments, setTodayAppointments,
    getServices
} from '../core/state.js';
import { formatTimeHHMM } from '../utils/formatters.js';
import { PAYMENT_FEES, calculateNetValue } from '../logic/finance.js';

/**
 * Carrega agendamentos com filtros opcionais
 * @param {Object} filters - Filtros opcionais
 * @param {string} filters.date - Data no formato YYYY-MM-DD
 * @param {string} filters.status - Status do agendamento
 * @returns {Promise<Array>}
 */
export async function loadAppointments(filters = {}) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error('Supabase não configurado');
        return [];
    }

    try {
        let query = supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .order('data_horario', { ascending: true });

        if (filters.date) {
            const startDate = `${filters.date}T00:00:00`;
            const endDate = `${filters.date}T23:59:59`;
            query = query.gte('data_horario', startDate).lte('data_horario', endDate);
        }

        if (filters.status && filters.status !== 'todos') {
            query = query.eq('status', filters.status);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Mapear dados da view para formato compatível
        const mappedAppointments = (data || []).map(apt => mapAppointmentData(apt));
        setAppointments(mappedAppointments);

        return mappedAppointments;
    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
        throw error;
    }
}

/**
 * Carrega agendamentos da data selecionada (overview)
 * @param {string} date - Data no formato YYYY-MM-DD
 * @returns {Promise<Array>}
 */
export async function loadTodayAppointments(date) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error('Supabase não configurado');
        return [];
    }

    const selectedDate = date || new Date().toISOString().split('T')[0];

    try {
        const startDate = `${selectedDate}T00:00:00`;
        const endDate = `${selectedDate}T23:59:59`;

        const { data, error } = await supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .gte('data_horario', startDate)
            .lte('data_horario', endDate)
            .order('horario_inicio', { ascending: true });

        if (error) throw error;

        const mappedAppointments = (data || []).map(apt => mapAppointmentData(apt));
        setTodayAppointments(mappedAppointments);

        return mappedAppointments;
    } catch (error) {
        console.error('Erro ao carregar agendamentos de hoje:', error);
        throw error;
    }
}

/**
 * Carrega agendamentos para a grade de horários
 * @param {string} date - Data no formato YYYY-MM-DD
 * @returns {Promise<Array>}
 */
export async function loadScheduleGridData(date) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error('Supabase não configurado');
        return [];
    }

    try {
        const startDate = `${date}T00:00:00`;
        const endDate = `${date}T23:59:59`;

        const { data, error } = await supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .gte('data_horario', startDate)
            .lte('data_horario', endDate);

        if (error) throw error;

        return data || [];
    } catch (error) {
        console.error('Erro ao carregar grade de horários:', error);
        throw error;
    }
}

/**
 * Agendamento seguro via RPC (Atomicidade no Banco)
 * @param {Object} params - Parâmetros do agendamento
 * @returns {Promise<Object>}
 */
export async function handleSecureBooking(params) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const { data, error } = await supabaseClient.rpc('realizar_agendamento_seguro', {
        p_cliente_id: params.clienteId,
        p_servico_id: params.servicoId,
        p_telefone: params.telefone,
        p_nome_cliente: params.nome,
        p_servico_nome: params.servico,
        p_data_horario: params.dataISO,
        p_horario_inicio: params.inicio,
        p_horario_fim: params.fim,
        p_preco: params.preco
    });

    if (error) {
        console.error('Erro RPC:', error);
        throw new Error(error.message || 'Erro ao processar agendamento no banco.');
    }

    if (!data || !data.success) {
        throw new Error(data?.error || 'Horário indisponível. Por favor, escolha outro.');
    }

    return data;
}

/**
 * Verifica conflito de horário (para edição de agendamentos)
 * @param {string} date - Data YYYY-MM-DD
 * @param {string} startTime - Horário início HH:MM
 * @param {string} endTime - Horário fim HH:MM
 * @param {number|null} excludeId - ID a excluir da verificação
 * @returns {Promise<{conflict: boolean, conflictWith?: object}>}
 */
export async function checkTimeConflict(date, startTime, endTime, excludeId = null) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) return { conflict: false };

    try {
        let query = supabaseClient
            .from('vw_agendamentos_completos')
            .select('id, cliente_nome, horario_inicio, horario_fim, status')
            .gte('data_horario', `${date}T00:00:00`)
            .lte('data_horario', `${date}T23:59:59`)
            .neq('status', 'cancelado');

        if (excludeId) {
            query = query.neq('id', excludeId);
        }

        const { data: existingAppointments, error } = await query;

        if (error) throw error;

        const timeToMinutes = (time) => {
            if (!time) return 0;
            const parts = time.split(':');
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        };

        const newStart = timeToMinutes(startTime);
        const newEnd = timeToMinutes(endTime);

        for (const apt of existingAppointments || []) {
            const aptStart = timeToMinutes(apt.horario_inicio);
            const aptEnd = timeToMinutes(apt.horario_fim);

            if (newStart < aptEnd && newEnd > aptStart) {
                return {
                    conflict: true,
                    conflictWith: {
                        ...apt,
                        nome_cliente: apt.cliente_nome
                    }
                };
            }
        }

        return { conflict: false };
    } catch (error) {
        console.error('Erro ao verificar conflitos:', error);
        return { conflict: false };
    }
}

/**
 * Atualiza um agendamento existente
 * @param {number} id - ID do agendamento
 * @param {Object} data - Dados a atualizar
 * @returns {Promise<Object>}
 */
export async function updateAppointment(id, data) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const { data: result, error } = await supabaseClient
        .from('agendamentos')
        .update(data)
        .eq('id', parseInt(id))
        .select();

    if (error) throw error;

    return result;
}

/**
 * Exclui um agendamento
 * @param {number} id - ID do agendamento
 * @returns {Promise<boolean>}
 */
export async function deleteAppointment(id) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const { error } = await supabaseClient
        .from('agendamentos')
        .delete()
        .eq('id', parseInt(id));

    if (error) throw error;

    return true;
}

/**
 * Busca um agendamento por ID
 * @param {number} id - ID do agendamento
 * @returns {Promise<Object>}
 */
export async function getAppointmentById(id) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const { data, error } = await supabaseClient
        .from('agendamentos')
        .select('*')
        .eq('id', id)
        .single();

    if (error) throw error;

    return data;
}

/**
 * Carrega serviços do banco
 * @returns {Promise<Array>}
 */
export async function loadServices() {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error('Supabase não configurado');
        return [];
    }

    try {
        const { data, error } = await supabaseClient
            .from('servicos')
            .select('*')
            .eq('ativo', true)
            .order('categoria', { ascending: true });

        if (error) throw error;

        return data || [];
    } catch (error) {
        console.error('Erro ao carregar serviços:', error);
        return [];
    }
}

// =====================================================
// HELPERS PRIVADOS
// =====================================================

/**
 * Mapeia dados da view para formato compatível
 * @param {Object} apt - Dados do agendamento da view
 * @returns {Object}
 */
function mapAppointmentData(apt) {
    const nomeCliente = apt.cliente_nome_completo || apt.nome_cliente || apt.cliente_nome;
    const telefoneCliente = apt.telefone || apt.cliente_telefone;

    return {
        id: apt.id,
        data_horario: apt.data_horario,
        horario_inicio: apt.horario_inicio,
        horario_fim: apt.horario_fim,
        status: apt.status,
        preco_cobrado: parseFloat(apt.preco) || parseFloat(apt.preco_cobrado) || 0,
        preco: parseFloat(apt.preco) || 0,
        observacoes: apt.observacoes,
        cliente_nome: isValidString(nomeCliente) ? nomeCliente : 'Cliente não identificado',
        telefone: isValidString(telefoneCliente) ? telefoneCliente : '',
        servico: apt.servico_nome || apt.servico,
        duracao_minutos: apt.duracao_minutos,
        valor_pago: apt.valor_pago || 0,
        valor_pendente: apt.valor_pendente || 0,
        pagamento: apt.status_pagamento,
        status_pagamento: apt.status_pagamento,
        forma_pagamento: apt.forma_pagamento || 'dinheiro',
        valor_liquido: apt.valor_liquido,
        taxa_aplicada: apt.taxa_aplicada,
        cliente_id: apt.cliente_id,
        servico_id: apt.servico_id
    };
}

/**
 * Verifica se uma string é válida (não nula, não vazia, não "undefined" ou "null")
 * @param {any} value 
 * @returns {boolean}
 */
function isValidString(value) {
    return typeof value === 'string' &&
        value.trim() &&
        !['undefined', 'null'].includes(value.trim().toLowerCase());
}
