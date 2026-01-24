/**
 * @module core/state
 * @description Estado global da aplicação com getters/setters
 * 
 * Este módulo elimina variáveis globais permitindo injeção de dependências
 */

// Estado interno (privado)
let _currentUser = null;
let _currentSection = 'overview';
let _appointments = [];
let _todayAppointments = [];
let _services = [];
let _clients = [];
let _allClients = [];

// Cache
const _dataCache = new Map();
const _clientsCache = new Map();
const _servicesCache = new Map();
let _clientsCacheTimestamp = 0;
const CLIENTS_CACHE_TTL = 60000; // 1 minuto

// =====================================================
// GETTERS
// =====================================================

export const getCurrentUser = () => _currentUser;
export const getCurrentSection = () => _currentSection;
export const getAppointments = () => _appointments;
export const getTodayAppointments = () => _todayAppointments;
export const getServices = () => _services;
export const getClients = () => _clients;
export const getAllClients = () => _allClients;
export const getDataCache = () => _dataCache;
export const getClientsCache = () => _clientsCache;
export const getServicesCache = () => _servicesCache;

// =====================================================
// SETTERS
// =====================================================

export const setCurrentUser = (user) => { _currentUser = user; };
export const setCurrentSection = (section) => { _currentSection = section; };
export const setAppointments = (data) => { _appointments = data; };
export const setTodayAppointments = (data) => { _todayAppointments = data; };
export const setServices = (data) => { _services = data; };
export const setClients = (data) => { _clients = data; };
export const setAllClients = (data) => { _allClients = data; };

// =====================================================
// CACHE HELPERS
// =====================================================

/**
 * Obtém dados do cache ou busca novos dados
 * @param {string} key - Chave do cache
 * @param {Function} fetchFunction - Função para buscar dados se não estiver em cache
 * @param {number} ttl - Tempo de vida do cache em ms (padrão 5 min)
 * @returns {Promise<any>}
 */
export function getCachedData(key, fetchFunction, ttl = 300000) {
    const cached = _dataCache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
        return Promise.resolve(cached.data);
    }

    return fetchFunction().then(data => {
        _dataCache.set(key, { data, timestamp: Date.now() });
        return data;
    });
}

/**
 * Limpa o cache (uma chave específica ou todo o cache)
 * @param {string|null} key - Chave a limpar ou null para limpar tudo
 */
export function clearCache(key = null) {
    if (key) {
        _dataCache.delete(key);
    } else {
        _dataCache.clear();
    }
}

/**
 * Verifica se o cache de clientes é válido
 * @param {boolean} forceRefresh - Forçar atualização
 * @returns {boolean}
 */
export function isClientsCacheValid(forceRefresh = false) {
    const now = Date.now();
    return !forceRefresh && _allClients.length > 0 && (now - _clientsCacheTimestamp) < CLIENTS_CACHE_TTL;
}

/**
 * Atualiza o timestamp do cache de clientes
 */
export function updateClientsCacheTimestamp() {
    _clientsCacheTimestamp = Date.now();
}

/**
 * Adiciona um cliente ao cache
 * @param {object} client 
 */
export function addToClientsCache(client) {
    _clientsCache.set(client.id, client);
}

/**
 * Adiciona um serviço ao cache
 * @param {object} service 
 */
export function addToServicesCache(service) {
    _servicesCache.set(service.id, service);
}

// =====================================================
// RESET
// =====================================================

/**
 * Reseta todo o estado (útil para logout)
 */
export function resetState() {
    _currentUser = null;
    _currentSection = 'overview';
    _appointments = [];
    _todayAppointments = [];
    _services = [];
    _clients = [];
    _allClients = [];
    _dataCache.clear();
    _clientsCache.clear();
    _servicesCache.clear();
    _clientsCacheTimestamp = 0;
}
