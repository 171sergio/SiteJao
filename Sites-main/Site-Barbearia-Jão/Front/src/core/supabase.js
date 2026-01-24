/**
 * @module core/supabase
 * @description Inicialização e configuração do cliente Supabase
 */

let supabaseClient = null;
let isSupabaseConfigured = false;

/**
 * Inicializa o cliente Supabase
 * @returns {{ client: object|null, isConfigured: boolean }}
 */
export function initSupabase() {
    // Verificar se as configurações do Supabase estão disponíveis
    if (typeof SUPABASE_CONFIG !== 'undefined' &&
        SUPABASE_CONFIG.url &&
        SUPABASE_CONFIG.anonKey &&
        SUPABASE_CONFIG.url !== 'https://your-project-ref.supabase.co' &&
        SUPABASE_CONFIG.anonKey !== 'your-anon-key-here') {

        try {
            // Verificar se a biblioteca Supabase foi carregada (via CDN no HTML)
            if (typeof supabase !== 'undefined' && supabase.createClient) {
                const { createClient } = supabase;
                supabaseClient = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
                isSupabaseConfigured = true;
                console.log('✅ Supabase inicializado com sucesso');
            } else {
                throw new Error('Biblioteca Supabase não carregada');
            }
        } catch (error) {
            console.error('❌ Erro ao configurar Supabase:', error);
            isSupabaseConfigured = false;
            supabaseClient = null;
        }
    } else {
        console.error('❌ Supabase não configurado. Configure o arquivo config.js');
        isSupabaseConfigured = false;
    }

    return { client: supabaseClient, isConfigured: isSupabaseConfigured };
}

/**
 * Retorna o cliente Supabase (singleton)
 * @returns {object|null}
 */
export function getSupabaseClient() {
    return supabaseClient;
}

/**
 * Verifica se o Supabase está configurado corretamente
 * @returns {boolean}
 */
export function isConfigured() {
    return isSupabaseConfigured;
}

/**
 * Configura a subscription de Realtime para atualizações automáticas
 * @param {Function} onAppointmentChange - Callback quando agendamentos mudam
 */
export function setupRealtimeSubscription(onAppointmentChange) {
    if (!supabaseClient) return;

    supabaseClient
        .channel('db-changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'agendamentos' },
            (payload) => {
                console.log('Realtime: mudança detectada', payload);
                if (onAppointmentChange) {
                    onAppointmentChange(payload);
                }
            }
        )
        .subscribe((status) => {
            console.log('Realtime subscription status:', status);
        });
}
