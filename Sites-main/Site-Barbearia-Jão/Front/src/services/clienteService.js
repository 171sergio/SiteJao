/**
 * @module services/clienteService
 * @description Serviço de operações CRUD para clientes
 */

import { getSupabaseClient } from '../core/supabase.js';
import {
    getAllClients, setAllClients,
    addToClientsCache, isClientsCacheValid, updateClientsCacheTimestamp
} from '../core/state.js';
import { normalizePhone, formatarTelefone } from '../utils/formatters.js';

/**
 * Carrega todos os clientes (com cache)
 * @param {boolean} forceRefresh - Forçar atualização ignorando cache
 * @returns {Promise<Array>}
 */
export async function loadAllClients(forceRefresh = false) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar clientes');
        return [];
    }

    // Usar cache se ainda válido
    if (isClientsCacheValid(forceRefresh)) {
        return getAllClients();
    }

    try {
        const { data, error } = await supabaseClient
            .from('clientes')
            .select('id, nome, telefone, telefone_normalizado')
            .eq('status_cliente', 'ativo')
            .order('nome')
            .limit(1000);

        if (error) throw error;

        setAllClients(data || []);
        updateClientsCacheTimestamp();

        return getAllClients();
    } catch (error) {
        console.error('Erro ao carregar clientes:', error);
        return getAllClients(); // Retornar cache anterior em caso de erro
    }
}

/**
 * Busca ou cria um cliente
 * @param {string} telefone - Telefone do cliente (opcional)
 * @param {string} nome - Nome do cliente
 * @returns {Promise<object>}
 */
export async function findOrCreateClient(telefone, nome) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    // Se telefone não foi fornecido, tentar buscar por nome exato ou criar novo
    if (!telefone || telefone.trim() === '') {
        try {
            // Tentar encontrar cliente existente pelo nome exato
            const { data: existingClient, error: searchError } = await supabaseClient
                .from('clientes')
                .select('*')
                .ilike('nome', nome.trim())
                .is('telefone', null)
                .single();

            if (!searchError && existingClient) {
                addToClientsCache(existingClient);
                return existingClient;
            }

            // Não encontrou por nome, criar novo cliente SEM telefone
            const { data: newClient, error: createError } = await supabaseClient
                .from('clientes')
                .insert([{
                    telefone: null,
                    nome: nome.trim(),
                    status_cliente: 'ativo'
                }])
                .select()
                .single();

            if (createError) {
                throw createError;
            }

            // Atualizar cache imediatamente após inserção bem-sucedida
            // ORDEM IMPORTANTE: 1) Invalidar cache existente, 2) Adicionar novo cliente
            try {
                // 1. Invalidar o cache para forçar refresh na próxima consulta
                updateClientsCacheTimestamp();

                // 2. Adicionar o novo cliente ao cache local
                addToClientsCache(newClient);
            } catch (cacheError) {
                // Não falhar a criação por erro de cache
                console.warn('Aviso: Erro ao atualizar cache, mas cliente foi criado:', cacheError);
            }

            return newClient;
        } catch (error) {
            console.error('Erro ao buscar/criar cliente sem telefone:', error);
            throw error;
        }
    }

    // Fluxo normal COM telefone
    const formattedPhone = formatarTelefone(telefone);
    const normalizedPhone = normalizePhone(telefone);

    try {
        // Primeiro, tentar encontrar cliente existente pelo telefone_normalizado
        const { data: existingClient, error: searchError } = await supabaseClient
            .from('clientes')
            .select('*')
            .eq('telefone_normalizado', normalizedPhone)
            .single();

        if (searchError && searchError.code !== 'PGRST116') {
            throw searchError;
        }

        if (existingClient) {
            addToClientsCache(existingClient);
            return existingClient;
        }

        // Cliente não encontrado, criar novo
        const { data: newClient, error: createError } = await supabaseClient
            .from('clientes')
            .insert([{
                telefone: formattedPhone,
                nome: nome,
                status_cliente: 'ativo'
            }])
            .select()
            .single();

        if (createError) {
            throw createError;
        }

        // Atualizar cache imediatamente após inserção bem-sucedida
        // ORDEM IMPORTANTE: 1) Invalidar cache existente, 2) Adicionar novo cliente
        try {
            // 1. Invalidar o cache para forçar refresh na próxima consulta
            updateClientsCacheTimestamp();

            // 2. Adicionar o novo cliente ao cache local
            addToClientsCache(newClient);
        } catch (cacheError) {
            // Não falhar a criação por erro de cache
            console.warn('Aviso: Erro ao atualizar cache, mas cliente foi criado:', cacheError);
        }

        return newClient;
    } catch (error) {
        console.error('Erro ao buscar/criar cliente:', error);
        throw error;
    }
}

/**
 * Busca nome do cliente por telefone
 * @param {string} phone 
 * @returns {Promise<string>}
 */
export async function getClientNameByPhone(phone) {
    const supabaseClient = getSupabaseClient();

    if (!supabaseClient) {
        const allClients = getAllClients();
        const client = allClients.find(c => c.telefone === phone);
        return client ? client.nome : `Cliente: ${phone}`;
    }

    try {
        const normalizedPhone = normalizePhone(phone);
        const { data, error } = await supabaseClient
            .from('clientes')
            .select('nome')
            .eq('telefone', normalizedPhone)
            .limit(1)
            .single();

        if (error) throw error;
        return data?.nome || `Cliente: ${phone}`;
    } catch (error) {
        console.error('Erro ao buscar nome do cliente:', error);
        return `Cliente: ${phone}`;
    }
}

/**
 * Carrega clientes para exibição na lista
 * @param {string} searchTerm - Termo de busca (opcional)
 * @returns {Promise<Array>}
 */
export async function loadClients(searchTerm = '') {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        console.error('Supabase não configurado');
        return [];
    }

    try {
        let query = supabaseClient
            .from('clientes')
            .select('*')
            .order('nome');

        if (searchTerm) {
            query = query.or(`nome.ilike.%${searchTerm}%,telefone.ilike.%${searchTerm}%`);
        }

        const { data, error } = await query;

        if (error) throw error;

        return data || [];
    } catch (error) {
        console.error('Erro ao carregar clientes:', error);
        return [];
    }
}

/**
 * Exclui um cliente
 * @param {number} clientId - ID do cliente
 * @param {string} clientName - Nome do cliente (para confirmação)
 * @returns {Promise<boolean>}
 */
export async function deleteClient(clientId, clientName) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    try {
        const { error } = await supabaseClient
            .from('clientes')
            .delete()
            .eq('id', clientId);

        if (error) throw error;

        console.log(`Cliente ${clientName} excluído com sucesso`);
        return true;
    } catch (error) {
        console.error('Erro ao excluir cliente:', error);
        throw error;
    }
}
