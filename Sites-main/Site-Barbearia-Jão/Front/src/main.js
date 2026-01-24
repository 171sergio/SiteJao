/**
 * @module main
 * @description Entry Point - Orquestrador central da aplicação
 * 
 * MÓDULO PURO - SEM EXPOSIÇÕES GLOBAIS (window.*)
 * 
 * Este arquivo:
 * - Inicializa o Supabase
 * - Configura Delegação de Eventos COMPLETA no documento
 * - Orquestra o carregamento inicial de dados
 * - NÃO expõe NENHUMA função ao escopo global
 * 
 * Todas as interações são gerenciadas via:
 * - data-action: identifica a ação a executar
 * - data-id: ID do registro (quando aplicável)
 * - data-*: dados adicionais necessários
 */

// =====================================================
// IMPORTS - Core
// =====================================================
import { initSupabase, getSupabaseClient, setupRealtimeSubscription } from './core/supabase.js';
import {
    setServices,
    setAllClients,
    getCurrentSection,
    resetState
} from './core/state.js';

// =====================================================
// IMPORTS - Services
// =====================================================
import {
    loadAppointments,
    loadTodayAppointments,
    loadScheduleGridData,
    loadServices,
    handleSecureBooking,
    updateAppointment,
    deleteAppointment as deleteAppointmentService,
    checkTimeConflict,
    getAppointmentById
} from './services/agendamentoService.js';

import {
    loadAllClients,
    findOrCreateClient,
    getClientNameByPhone,
    loadClients as loadClientsService,
    deleteClient as deleteClientService
} from './services/clienteService.js';

import {
    loadUnpaidClients,
    markAsPaidByInadimplente as markAsPaidService,
    deleteUnpaidClient as deleteUnpaidClientService,
    createInadimplenteFromAppointment,
    registerContactAttempt
} from './services/inadimplenteService.js';

// =====================================================
// IMPORTS - UI
// =====================================================
import { showNotification, showLoading, hideLoading, confirmDelete } from './ui/notifications.js';
import {
    renderAppointmentsTable,
    renderTodaySchedule,
    renderScheduleGrid,
    renderClientsTable,
    renderClientsGrid,
    renderUnpaidTable,
    updateUnpaidSummary
} from './ui/renderers.js';

import {
    showSection,
    handleNavigation,
    editAppointment as editAppointmentModal,
    closeModal,
    openAddAppointmentModal,
    closeAddModal,
    openQuickCompleteModal as openQuickCompleteModalUI,
    closeQuickCompleteModal,
    updateQuickCompleteSummary,
    openRetroModal,
    closeRetroModal,
    openAddUnpaidModal,
    closeAddUnpaidModal,
    openInadimplentePaymentModal,
    closeInadimplentePaymentModal,
    openAddClientModal,
    closeAddClientModal,
    closeEditClientModal,
    openQuickClientModal,
    closeQuickClientModal,
    handleTimeSlotClick as handleTimeSlotClickUI,
    setupModalCloseOnClickOutside,
    togglePaymentMethodVisibility
} from './ui/modals.js';

// =====================================================
// IMPORTS - Logic & Utils
// =====================================================
import { PAYMENT_FEES, calculateNetValue } from './logic/finance.js';
import { validateAppointmentData } from './logic/validators.js';
import {
    normalizePhone,
    formatPhoneDisplay,
    formatarTelefone,
    formatDate,
    formatTimeHHMM,
    desmembrarTelefone,
    montarTelefone,
    formatarNumeroDigitando,
    calculateEndTime,
    getFormattedTime,
    debounce,
    getTodayDateString,
    getTomorrowDateString
} from './utils/formatters.js';

// =====================================================
// ESTADO LOCAL DO MÓDULO (encapsulado, não global)
// =====================================================
let currentInadimplenteData = null;
let isInitialized = false;

// =====================================================
// REFRESH DATA - Função central para recarregar dados
// =====================================================

async function refreshData() {
    const today = getTodayDateString();

    try {
        const todayAppointments = await loadTodayAppointments(today);
        renderTodaySchedule(todayAppointments);

        const allAppointments = await loadAppointments();
        renderAppointmentsTable(allAppointments);

        const scheduleDate = document.getElementById('scheduleDate')?.value || today;
        const scheduleData = await loadScheduleGridData(scheduleDate);
        renderScheduleGrid(scheduleData, scheduleDate);

    } catch (error) {
        console.error('Erro ao atualizar dados:', error);
    }
}

async function loadOverviewData() {
    const today = getTodayDateString();
    const todayAppointments = await loadTodayAppointments(today);
    renderTodaySchedule(todayAppointments);
    updateOverviewStats(todayAppointments);
}

function updateOverviewStats(appointments) {
    const totalAgendamentos = appointments.length;
    const concluidos = appointments.filter(a => a.status === 'concluido').length;
    const pendentes = appointments.filter(a => a.status === 'agendado' || a.status === 'confirmado').length;
    const faturamentoHoje = appointments
        .filter(a => a.status === 'concluido')
        .reduce((sum, a) => sum + (parseFloat(a.preco) || 0), 0);

    const totalEl = document.getElementById('todayTotal');
    const completedEl = document.getElementById('todayCompleted');
    const pendingEl = document.getElementById('todayPending');
    const revenueEl = document.getElementById('todayRevenue');

    if (totalEl) totalEl.textContent = totalAgendamentos;
    if (completedEl) completedEl.textContent = concluidos;
    if (pendingEl) pendingEl.textContent = pendentes;
    if (revenueEl) revenueEl.textContent = `R$ ${faturamentoHoje.toFixed(2)}`;
}

async function loadScheduleGrid() {
    const dateInput = document.getElementById('scheduleDate');
    const selectedDate = dateInput?.value || getTodayDateString();
    const shiftFilter = document.querySelector('input[name="shiftFilter"]:checked')?.value || 'all';
    const appointments = await loadScheduleGridData(selectedDate);
    renderScheduleGrid(appointments, selectedDate, { shiftFilter });
}

// =====================================================
// HANDLERS DE AÇÕES - AGENDAMENTOS
// =====================================================

async function handleEditAppointment(id) {
    try {
        await editAppointmentModal(id);
    } catch (error) {
        console.error('Erro ao editar agendamento:', error);
        showNotification('Erro ao abrir edição: ' + error.message, 'error');
    }
}

async function handleDeleteAppointment(id) {
    if (!confirmDelete('agendamento', 'agendamento')) return;

    try {
        showLoading();
        await deleteAppointmentService(id);
        showNotification('Agendamento excluído com sucesso!', 'success');
        await refreshData();
    } catch (error) {
        console.error('Erro ao excluir agendamento:', error);
        showNotification('Erro ao excluir agendamento: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function handleCompleteAppointment(id) {
    try {
        await openQuickCompleteModalUI(id);
    } catch (error) {
        console.error('Erro ao abrir conclusão rápida:', error);
        showNotification('Erro ao abrir modal: ' + error.message, 'error');
    }
}

// =====================================================
// HANDLERS DE AÇÕES - INADIMPLENTES
// =====================================================

async function handleMarkPaid(inadimplenteId) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    try {
        const { data: inadimplente, error } = await supabaseClient
            .from('inadimplentes')
            .select('*, agendamentos(servico, preco_cobrado, nome_cliente)')
            .eq('id', inadimplenteId)
            .single();

        if (error) throw error;

        currentInadimplenteData = inadimplente;

        document.getElementById('inadimplentePaymentId').value = inadimplenteId;

        const clienteNome = inadimplente.nome_cliente || inadimplente.agendamentos?.nome_cliente || 'Cliente';
        const servico = inadimplente.agendamentos?.servico || inadimplente.servico || 'Serviço';
        const valor = parseFloat(inadimplente.valor_devido) || 0;

        document.getElementById('inadimplentePaymentInfo').innerHTML = `
            <div class="info-row"><strong>Cliente:</strong> ${clienteNome}</div>
            <div class="info-row"><strong>Serviço:</strong> ${servico}</div>
            <div class="info-row"><strong>Valor:</strong> <span class="highlight">R$ ${valor.toFixed(2)}</span></div>
        `;

        document.getElementById('inadimplentePaymentMethod').value = 'dinheiro';
        updateInadimplentePaymentSummary();

        document.getElementById('inadimplentePaymentModal').style.display = 'flex';

    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        showNotification('Erro ao carregar dados: ' + error.message, 'error');
    }
}

async function handleEditUnpaid(id) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) return;

    try {
        const { data: inadimplente, error } = await supabaseClient
            .from('inadimplentes')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        openAddUnpaidModal();

        const modalTitle = document.querySelector('#addUnpaidModal .modal-header h4');
        if (modalTitle) modalTitle.textContent = 'Editar Inadimplência';

        const submitBtn = document.querySelector('#addUnpaidModal button[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Salvar Alterações';

        document.getElementById('editUnpaidId').value = inadimplente.id;
        document.getElementById('addUnpaidNome').value = inadimplente.nome_cliente || '';
        document.getElementById('addUnpaidTelefone').value = inadimplente.telefone || '';
        document.getElementById('addUnpaidServico').value = inadimplente.servico || '';
        document.getElementById('addUnpaidData').value = inadimplente.data_vencimento || '';
        document.getElementById('addUnpaidValor').value = inadimplente.valor_devido || '';
        document.getElementById('addUnpaidObservacoes').value = inadimplente.observacoes_cobranca || '';

    } catch (error) {
        showNotification('Erro ao carregar dados: ' + error.message, 'error');
    }
}

async function handleDeleteUnpaid(id) {
    if (!confirm('Tem certeza que deseja excluir este registro de inadimplência?')) return;

    try {
        showLoading();
        await deleteUnpaidClientService(id);
        showNotification('Registro excluído com sucesso!', 'success');
        await loadUnpaidSection();
    } catch (error) {
        console.error('Erro ao excluir inadimplente:', error);
        showNotification('Erro ao excluir: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function handleContactUnpaid(telefone, nome, agendamentoId) {
    const normalizedPhone = normalizePhone(telefone);
    const message = `Olá ${nome}! Esperamos que esteja bem. Gostaríamos de lembrar sobre o pagamento pendente do seu último atendimento na Barbearia. Agradecemos a compreensão!`;
    const whatsappUrl = `https://wa.me/55${normalizedPhone}?text=${encodeURIComponent(message)}`;

    if (agendamentoId) {
        registerContactAttempt(agendamentoId);
    }

    window.open(whatsappUrl, '_blank');
}

// =====================================================
// HANDLERS DE AÇÕES - CLIENTES
// =====================================================

async function handleEditClient(id) {
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) return;

    try {
        showLoading();
        const { data: client, error } = await supabaseClient
            .from('clientes')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        document.getElementById('editClientId').value = client.id;
        document.getElementById('editClientNome').value = client.nome;
        document.getElementById('editClientTelefone').value = client.telefone;
        document.getElementById('editClientEmail').value = client.email || '';
        document.getElementById('editClientDataNascimento').value = client.data_nascimento || '';
        document.getElementById('editClientStatus').value = client.status_cliente;
        document.getElementById('editClientObservacoes').value = client.observacoes || '';

        desmembrarTelefone(client.telefone, 'editClientDDD', 'editClientNumero');

        document.getElementById('editClientModal').style.display = 'block';
    } catch (error) {
        showNotification('Erro ao carregar cliente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function handleDeleteClient(id, nome) {
    if (!confirmDelete(nome, 'cliente')) return;

    try {
        showLoading();
        await deleteClientService(id, nome);
        showNotification('Cliente excluído com sucesso!', 'success');
        await loadClientsSection();
    } catch (error) {
        console.error('Erro ao excluir cliente:', error);
        showNotification('Erro ao excluir cliente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function handleContactClient(telefone, nome) {
    const normalizedPhone = normalizePhone(telefone);
    const message = `Olá ${nome}! Como está? Aqui é da Barbearia do Jão. Esperamos vê-lo em breve!`;
    const whatsappUrl = `https://wa.me/55${normalizedPhone}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
}

// =====================================================
// FUNÇÕES DE PAGAMENTO INADIMPLENTE
// =====================================================

function updateInadimplentePaymentSummary() {
    if (!currentInadimplenteData) return;

    const method = document.getElementById('inadimplentePaymentMethod').value;
    const valor = parseFloat(currentInadimplenteData.valor_devido) || 0;
    const taxaPercent = PAYMENT_FEES[method] || 0;
    const valorLiquido = calculateNetValue(valor, method);
    const taxaValor = valor - valorLiquido;

    const summaryEl = document.getElementById('inadimplentePaymentSummary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="summary-row">
                <span>Valor Bruto:</span>
                <span>R$ ${valor.toFixed(2)}</span>
            </div>
            <div class="summary-row ${taxaPercent > 0 ? 'danger' : ''}">
                <span>Taxa (${taxaPercent}%):</span>
                <span>- R$ ${taxaValor.toFixed(2)}</span>
            </div>
            <div class="summary-row total">
                <span><strong>Valor Líquido:</strong></span>
                <span class="success"><strong>R$ ${valorLiquido.toFixed(2)}</strong></span>
            </div>
        `;
    }
}

async function confirmInadimplentePayment() {
    if (!currentInadimplenteData) {
        showNotification('Erro: dados não encontrados', 'error');
        return;
    }

    const inadimplenteId = parseInt(document.getElementById('inadimplentePaymentId').value);
    const paymentMethod = document.getElementById('inadimplentePaymentMethod').value;

    try {
        showLoading();
        await markAsPaidService(inadimplenteId, paymentMethod);
        closeInadimplentePaymentModal();
        showNotification('Pagamento confirmado com sucesso!', 'success');
        await loadUnpaidSection();
        await refreshData();
    } catch (error) {
        console.error('Erro ao confirmar pagamento:', error);
        showNotification('Erro ao confirmar pagamento: ' + error.message, 'error');
    } finally {
        hideLoading();
        currentInadimplenteData = null;
    }
}

// =====================================================
// CARREGAMENTO DE SEÇÕES
// =====================================================

async function loadClientsSection() {
    try {
        showLoading();
        const clients = await loadClientsService();
        renderClientsTable(clients);
    } catch (error) {
        console.error('Erro ao carregar clientes:', error);
        showNotification('Erro ao carregar clientes', 'error');
    } finally {
        hideLoading();
    }
}

async function loadUnpaidSection() {
    try {
        showLoading();
        const filterClient = document.getElementById('unpaidClientFilter')?.value?.trim() || '';
        const unpaidClients = await loadUnpaidClients(filterClient);
        renderUnpaidTable(unpaidClients);
        updateUnpaidSummary(unpaidClients);
    } catch (error) {
        console.error('Erro ao carregar inadimplentes:', error);
        showNotification('Erro ao carregar inadimplentes', 'error');
    } finally {
        hideLoading();
    }
}

async function loadAppointmentsSection() {
    try {
        showLoading();
        const appointments = await loadAppointments();
        renderAppointmentsTable(appointments);
    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
        showNotification('Erro ao carregar agendamentos', 'error');
    } finally {
        hideLoading();
    }
}

// =====================================================
// MAPA DE AÇÕES - Delegação de Eventos Centralizada
// =====================================================

/**
 * Mapa completo de ações suportadas pela delegação de eventos.
 * Cada chave corresponde ao valor do atributo data-action.
 * O handler recebe o elemento clicado e pode extrair dados via dataset.
 */
const ACTION_HANDLERS = {
    // === AGENDAMENTOS ===
    'complete': async (el) => await handleCompleteAppointment(parseInt(el.dataset.id)),
    'edit-appointment': async (el) => await handleEditAppointment(parseInt(el.dataset.id)),
    'delete-appointment': async (el) => await handleDeleteAppointment(parseInt(el.dataset.id)),

    // === INADIMPLENTES ===
    'mark-paid': async (el) => await handleMarkPaid(parseInt(el.dataset.id)),
    'edit-unpaid': async (el) => await handleEditUnpaid(parseInt(el.dataset.id)),
    'delete-unpaid': async (el) => await handleDeleteUnpaid(parseInt(el.dataset.id)),
    'contact-unpaid': (el) => handleContactUnpaid(
        el.dataset.telefone,
        el.dataset.nome,
        el.dataset.agendamentoId
    ),

    // === CLIENTES ===
    'edit-client': async (el) => await handleEditClient(parseInt(el.dataset.id)),
    'delete-client': async (el) => await handleDeleteClient(parseInt(el.dataset.id), el.dataset.nome),
    'contact-client': (el) => handleContactClient(el.dataset.telefone, el.dataset.nome),

    // === MODAIS - ABRIR ===
    'open-add-appointment': () => openAddAppointmentModal(),
    'open-retro': () => openRetroModal(),
    'open-add-unpaid': () => openAddUnpaidModal(),
    'open-add-client': () => openAddClientModal(),
    'open-quick-client': () => openQuickClientModal(),

    // === MODAIS - FECHAR ===
    'close-modal': () => closeModal(),
    'close-add-modal': () => closeAddModal(),
    'close-quick-complete': () => closeQuickCompleteModal(),
    'close-retro': () => closeRetroModal(),
    'close-add-unpaid': () => closeAddUnpaidModal(),
    'close-inadimplente-payment': () => closeInadimplentePaymentModal(),
    'close-add-client': () => closeAddClientModal(),
    'close-edit-client': () => closeEditClientModal(),
    'close-quick-client': () => closeQuickClientModal(),

    // === PAGAMENTO INADIMPLENTE ===
    'confirm-inadimplente-payment': async () => await confirmInadimplentePayment(),

    // === NAVEGAÇÃO ===
    'show-section': (el) => showSection(el.dataset.section),

    // === SCHEDULE ===
    'set-today': () => {
        document.getElementById('scheduleDate').value = getTodayDateString();
        loadScheduleGrid();
    },
    'set-tomorrow': () => {
        document.getElementById('scheduleDate').value = getTomorrowDateString();
        loadScheduleGrid();
    },
    'time-slot-click': (el) => handleTimeSlotClickUI(el.dataset.time, el.dataset.date, el.dataset.occupied),

    // === RECARREGAR DADOS ===
    'refresh-appointments': async () => await loadAppointmentsSection(),
    'refresh-unpaid': async () => await loadUnpaidSection(),
    'refresh-clients': async () => await loadClientsSection(),
    'refresh-schedule': async () => await loadScheduleGrid(),
    'refresh-data': async () => await refreshData()
};

// =====================================================
// DELEGAÇÃO DE EVENTOS - DOCUMENT LEVEL
// =====================================================

/**
 * Configura delegação de eventos no documento inteiro.
 * Captura TODOS os cliques em elementos com data-action.
 * 
 * Benefícios:
 * - Um único event listener para toda a aplicação
 * - Funciona com elementos adicionados dinamicamente
 * - Zero exposições globais (window.*)
 * - Performance otimizada
 */
function setupDelegatedEventListeners() {
    // Prevenir múltiplas inicializações
    if (isInitialized) {
        console.warn('⚠️ Delegação de eventos já configurada');
        return;
    }

    document.addEventListener('click', async (event) => {
        // Buscar elemento com data-action (pode ser o target ou ancestral)
        const actionElement = event.target.closest('[data-action]');
        if (!actionElement) return;

        const action = actionElement.dataset.action;
        const handler = ACTION_HANDLERS[action];

        if (!handler) {
            console.warn(`⚠️ Ação não reconhecida: ${action}`);
            return;
        }

        // Prevenir comportamento padrão para links
        if (event.target.tagName === 'A' || actionElement.tagName === 'A') {
            event.preventDefault();
        }

        try {
            await handler(actionElement);
        } catch (error) {
            console.error(`❌ Erro ao executar ação "${action}":`, error);
            showNotification(`Erro: ${error.message}`, 'error');
        }
    });

    // Delegação para eventos de input (formatação de telefone)
    document.addEventListener('input', (event) => {
        const target = event.target;

        // Formatação de telefone durante digitação
        if (target.dataset.format === 'phone') {
            formatarNumeroDigitando(target.id);
        }
    });

    // Delegação para eventos de change
    document.addEventListener('change', (event) => {
        const target = event.target;
        const changeAction = target.dataset.changeAction;

        if (!changeAction) return;

        switch (changeAction) {
            case 'toggle-payment-method':
                togglePaymentMethodVisibility(target.dataset.prefix);
                break;
            case 'update-quick-complete-summary':
                updateQuickCompleteSummary();
                break;
            case 'update-inadimplente-summary':
                updateInadimplentePaymentSummary();
                break;
        }
    });

    console.log('✅ Delegação de eventos configurada no document');
    isInitialized = true;
}

// =====================================================
// SETUP DE EVENT LISTENERS (não delegados)
// =====================================================

function setupEventListeners() {
    // Navegação via links do menu
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.addEventListener('click', handleNavigation);
    });

    // Fechar modais ao clicar fora
    setupModalCloseOnClickOutside();

    // Data do schedule (change event)
    const scheduleDateInput = document.getElementById('scheduleDate');
    if (scheduleDateInput) {
        scheduleDateInput.addEventListener('change', loadScheduleGrid);
    }

    // Filtros de turno
    document.querySelectorAll('input[name="shiftFilter"]').forEach(radio => {
        radio.addEventListener('change', loadScheduleGrid);
    });

    // Busca de clientes (debounced)
    const clientSearchInput = document.getElementById('clientSearch');
    if (clientSearchInput) {
        const debouncedSearch = debounce(() => loadClientsSection(), 500);
        clientSearchInput.addEventListener('input', debouncedSearch);
    }

    // Filtro de inadimplentes (debounced)
    const unpaidFilterInput = document.getElementById('unpaidClientFilter');
    if (unpaidFilterInput) {
        const debouncedFilter = debounce(() => loadUnpaidSection(), 500);
        unpaidFilterInput.addEventListener('input', debouncedFilter);
    }
}

// =====================================================
// POPULAR SELECTS DE SERVIÇOS
// =====================================================

function popularSelectsServicos(services) {
    const selects = ['addServico', 'editServico', 'retroServico', 'addUnpaidServico'];

    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const firstOption = select.options[0];
            select.innerHTML = '';
            if (firstOption) select.appendChild(firstOption);

            services.forEach(service => {
                const option = document.createElement('option');
                option.value = service.nome;
                option.textContent = service.nome;
                select.appendChild(option);
            });
        }
    });
}

// =====================================================
// INICIALIZAÇÃO
// =====================================================

async function init() {
    console.log('🚀 Inicializando aplicação (Módulo Puro - Sem window.*)...');

    try {
        const { client, isConfigured } = initSupabase();

        if (!isConfigured) {
            showNotification('⚠️ Supabase não configurado. Configure o arquivo config.js', 'warning');
            return;
        }

        console.log('✅ Supabase conectado');

        // Setup da delegação de eventos (apenas uma vez, no document)
        setupDelegatedEventListeners();

        // Setup dos demais event listeners
        setupEventListeners();
        console.log('✅ Event Listeners configurados');

        showLoading();

        // Carregar serviços
        const services = await loadServices();
        setServices(services);
        popularSelectsServicos(services);
        console.log(`✅ ${services.length} serviços carregados`);

        // Carregar clientes para autocomplete
        const clients = await loadAllClients();
        setAllClients(clients);
        console.log(`✅ ${clients.length} clientes carregados`);

        // Carregar dados do overview
        await loadOverviewData();
        console.log('✅ Overview carregado');

        // Configurar Realtime
        setupRealtimeSubscription(async (payload) => {
            console.log('📡 Realtime update:', payload.eventType);
            await refreshData();
        });
        console.log('✅ Realtime configurado');

        hideLoading();
        console.log('🎉 Aplicação inicializada com sucesso! (Zero window.*)');

    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
        showNotification('Erro ao inicializar aplicação: ' + error.message, 'error');
        hideLoading();
    }
}

// =====================================================
// PONTO DE ENTRADA - SEM EXPOSIÇÕES GLOBAIS
// =====================================================

// Inicializa quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', init);

// =====================================================
// VERIFICAÇÃO DE ESCOPO GLOBAL (DEBUG)
// =====================================================

// Em desenvolvimento, verificar que não há fugas para o escopo global
if (typeof window !== 'undefined' && process?.env?.NODE_ENV === 'development') {
    console.log('🔍 Verificando escopo global...');
    const moduleFunctions = [
        'editAppointment', 'deleteAppointment', 'openQuickCompleteModal',
        'closeModal', 'refreshData', 'loadScheduleGrid'
    ];

    moduleFunctions.forEach(fn => {
        if (typeof window[fn] === 'function') {
            console.warn(`⚠️ Função "${fn}" ainda exposta globalmente!`);
        }
    });
}
