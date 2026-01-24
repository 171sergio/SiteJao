/**
 * @module ui/modals
 * @description Gerenciamento de modais e navegação entre seções
 */

import { showNotification, showLoading, hideLoading } from './notifications.js';
import {
    getAppointmentById,
    loadAppointments,
    loadTodayAppointments,
    loadScheduleGridData
} from '../services/agendamentoService.js';
import { PAYMENT_FEES, calculateNetValue } from '../logic/finance.js';

// =====================================================
// TOGGLE PAYMENT METHOD (pertence à UI, não à lógica)
// =====================================================

/**
 * Mostra/esconde o campo de forma de pagamento baseado no status selecionado
 * @param {string} prefix - Prefixo do ID (ex: 'add', 'edit', 'retro')
 */
export function togglePaymentMethodVisibility(prefix) {
    const statusSelect = document.getElementById(`${prefix}Status`);
    const paymentGroup = document.getElementById(`${prefix}PaymentMethodGroup`);
    if (statusSelect && paymentGroup) {
        paymentGroup.style.display = statusSelect.value === 'concluido' ? 'block' : 'none';
    }
}
import {
    formatTimeHHMM,
    desmembrarTelefone,
    formatDate,
    calculateEndTime,
    getTodayDateString
} from '../utils/formatters.js';
import { setCurrentSection, getCurrentSection } from '../core/state.js';

// =====================================================
// NAVEGAÇÃO ENTRE SEÇÕES
// =====================================================

/**
 * Mostra uma seção e esconde as outras
 * @param {string} sectionId - ID da seção a exibir
 */
export function showSection(sectionId) {
    // Esconder todas as seções
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    // Mostrar seção selecionada
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    // Atualizar menu de navegação
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-section') === sectionId) {
            link.classList.add('active');
        }
    });

    // Atualizar estado
    setCurrentSection(sectionId);
}

/**
 * Handler para navegação do menu
 * @param {Event} e - Evento de clique
 */
export function handleNavigation(e) {
    e.preventDefault();
    const sectionId = e.currentTarget.getAttribute('data-section');
    if (sectionId) {
        showSection(sectionId);
    }
}

// =====================================================
// MODAL DE EDIÇÃO (AGENDAMENTO)
// =====================================================

/**
 * Abre o modal de edição de agendamento
 * @param {number} id - ID do agendamento
 */
export async function editAppointment(id) {
    try {
        showLoading();

        const appointment = await getAppointmentById(id);

        if (!appointment) {
            showNotification('Agendamento não encontrado', 'error');
            return;
        }

        // Preencher campos do modal
        document.getElementById('editId').value = appointment.id;
        document.getElementById('editNome').value = appointment.nome_cliente || '';
        document.getElementById('editServico').value = appointment.servico || '';
        document.getElementById('editData').value = appointment.data_horario?.split('T')[0] || '';
        document.getElementById('editHorarioInicio').value = formatTimeHHMM(appointment.horario_inicio);
        document.getElementById('editHorarioFim').value = formatTimeHHMM(appointment.horario_fim);
        document.getElementById('editPreco').value = appointment.preco || '';
        document.getElementById('editStatus').value = appointment.status || 'agendado';
        document.getElementById('editObservacoes').value = appointment.observacoes || '';

        // Preencher telefone
        const editTelefone = document.getElementById('editTelefone');
        if (editTelefone) {
            editTelefone.value = appointment.telefone || '';
        }

        // Desmembrar telefone nos campos DDD e Número
        desmembrarTelefone(appointment.telefone, 'editDDD', 'editNumero');

        // Toggle pagamento
        togglePaymentMethodVisibility('edit');

        // Forma de pagamento
        const formaPagamento = document.getElementById('editFormaPagamento');
        if (formaPagamento) {
            formaPagamento.value = appointment.forma_pagamento || 'dinheiro';
        }

        // Abrir modal
        document.getElementById('editModal').style.display = 'block';

    } catch (error) {
        console.error('Erro ao carregar agendamento:', error);
        showNotification('Erro ao carregar agendamento: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Fecha o modal de edição
 */
export function closeModal() {
    document.getElementById('editModal').style.display = 'none';

    // Limpar sugestões
    const suggestionsContainer = document.getElementById('clientSuggestions');
    if (suggestionsContainer) {
        suggestionsContainer.style.display = 'none';
    }
}

// =====================================================
// MODAL DE ADICIONAR AGENDAMENTO
// =====================================================

/**
 * Abre o modal de adicionar agendamento
 */
export function openAddAppointmentModal() {
    // Definir data de hoje por padrão
    document.getElementById('addData').value = getTodayDateString();

    // Limpar campos
    document.getElementById('addNome').value = '';
    document.getElementById('addTelefone').value = '';
    const addDDD = document.getElementById('addDDD');
    const addNumero = document.getElementById('addNumero');
    if (addDDD) addDDD.value = '';
    if (addNumero) addNumero.value = '';
    document.getElementById('addServico').value = '';
    document.getElementById('addHorarioInicio').value = '';
    document.getElementById('addHorarioFim').value = '';
    document.getElementById('addPreco').value = '';
    document.getElementById('addStatus').value = 'agendado';
    document.getElementById('addObservacoes').value = '';

    // Toggle pagamento
    togglePaymentMethodVisibility('add');

    // Mostrar modal
    document.getElementById('addModal').style.display = 'block';
}

/**
 * Fecha o modal de adicionar agendamento
 */
export function closeAddModal() {
    document.getElementById('addModal').style.display = 'none';
}

// =====================================================
// MODAL QUICK COMPLETE
// =====================================================

/**
 * Abre o modal de conclusão rápida
 * @param {number} appointmentId - ID do agendamento
 */
export async function openQuickCompleteModal(appointmentId) {
    try {
        showLoading();

        const appointment = await getAppointmentById(appointmentId);

        if (!appointment) {
            showNotification('Agendamento não encontrado', 'error');
            return;
        }

        // Preencher modal
        document.getElementById('quickCompleteId').value = appointment.id;

        const preco = parseFloat(appointment.preco) || parseFloat(appointment.preco_cobrado) || 0;

        document.getElementById('quickCompleteInfo').innerHTML = `
            <div class="info-row"><strong>Cliente:</strong> ${appointment.nome_cliente || 'N/A'}</div>
            <div class="info-row"><strong>Serviço:</strong> ${appointment.servico || 'N/A'}</div>
            <div class="info-row"><strong>Valor:</strong> <span class="highlight">R$ ${preco.toFixed(2)}</span></div>
        `;

        // Reset pagamento
        document.getElementById('quickCompletePaymentMethod').value = 'dinheiro';
        document.getElementById('quickCompletePagamento').value = 'pago';

        updateQuickCompleteSummary();

        // Abrir modal
        document.getElementById('quickCompleteModal').style.display = 'flex';

    } catch (error) {
        console.error('Erro ao abrir modal:', error);
        showNotification('Erro ao carregar dados: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

/**
 * Fecha o modal de conclusão rápida
 */
export function closeQuickCompleteModal() {
    document.getElementById('quickCompleteModal').style.display = 'none';
}

/**
 * Atualiza o resumo de pagamento no modal Quick Complete
 */
export function updateQuickCompleteSummary() {
    const appointmentId = document.getElementById('quickCompleteId').value;
    const method = document.getElementById('quickCompletePaymentMethod').value;

    // Extrair valor do info
    const infoEl = document.getElementById('quickCompleteInfo');
    const valorMatch = infoEl.innerHTML.match(/R\$\s*([\d,\.]+)/);
    const valor = valorMatch ? parseFloat(valorMatch[1].replace(',', '.')) : 0;

    const taxaPercent = PAYMENT_FEES[method] || 0;
    const valorLiquido = calculateNetValue(valor, method);
    const taxaValor = valor - valorLiquido;

    const summaryEl = document.getElementById('quickCompleteSummary');
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

// =====================================================
// MODAL RETROATIVO
// =====================================================

/**
 * Abre o modal de agendamento retroativo
 */
export function openRetroModal() {
    document.getElementById('retroData').value = getTodayDateString();

    // Limpar campos
    document.getElementById('retroNome').value = '';
    document.getElementById('retroTelefone').value = '';
    const retroDDD = document.getElementById('retroDDD');
    const retroNumero = document.getElementById('retroNumero');
    if (retroDDD) retroDDD.value = '';
    if (retroNumero) retroNumero.value = '';
    document.getElementById('retroServico').value = '';
    document.getElementById('retroHorarioInicio').value = '';
    document.getElementById('retroHorarioFim').value = '';
    document.getElementById('retroPreco').value = '';
    document.getElementById('retroStatus').value = 'concluido';
    document.getElementById('retroObservacoes').value = '';

    // Toggle pagamento
    togglePaymentMethodVisibility('retro');

    document.getElementById('retroModal').style.display = 'block';
}

/**
 * Fecha o modal retroativo
 */
export function closeRetroModal() {
    document.getElementById('retroModal').style.display = 'none';
}

// =====================================================
// MODAL DE INADIMPLENTES
// =====================================================

/**
 * Abre o modal de adicionar inadimplente
 */
export function openAddUnpaidModal() {
    const modal = document.getElementById('addUnpaidModal');
    if (!modal) {
        console.error('Modal addUnpaidModal não encontrado!');
        showNotification('Erro: Modal não encontrado', 'error');
        return;
    }

    modal.style.display = 'block';

    // Definir data padrão como hoje
    const dataField = document.getElementById('addUnpaidData');
    if (dataField) {
        dataField.value = getTodayDateString();
    }

    // Limpar formulário
    const form = document.getElementById('addUnpaidForm');
    if (form) {
        form.reset();
        if (dataField) {
            dataField.value = getTodayDateString();
        }
    }
}

/**
 * Fecha o modal de adicionar inadimplente
 */
export function closeAddUnpaidModal() {
    const modal = document.getElementById('addUnpaidModal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Limpar formulário
    const form = document.getElementById('addUnpaidForm');
    if (form) form.reset();

    // Limpar ID de edição
    const editIdField = document.getElementById('editUnpaidId');
    if (editIdField) editIdField.value = '';

    // Restaurar título e botão
    const modalTitle = document.querySelector('#addUnpaidModal .modal-header h4');
    if (modalTitle) modalTitle.textContent = 'Adicionar Cliente Inadimplente';

    const submitBtn = document.querySelector('#addUnpaidModal button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Adicionar';
}

/**
 * Abre o modal de pagamento de inadimplente
 * @param {number} inadimplenteId - ID da inadimplência
 */
export function openInadimplentePaymentModal(inadimplenteId) {
    document.getElementById('inadimplentePaymentId').value = inadimplenteId;
    document.getElementById('inadimplentePaymentMethod').value = 'dinheiro';
    document.getElementById('inadimplentePaymentModal').style.display = 'flex';
}

/**
 * Fecha o modal de pagamento de inadimplente
 */
export function closeInadimplentePaymentModal() {
    document.getElementById('inadimplentePaymentModal').style.display = 'none';
}

// =====================================================
// MODAL DE CLIENTES
// =====================================================

/**
 * Abre o modal de adicionar cliente
 */
export function openAddClientModal() {
    const modal = document.getElementById('addClientModal');
    if (modal) {
        modal.style.display = 'block';
    }

    // Limpar formulário
    const form = document.getElementById('addClientForm');
    if (form) form.reset();

    const statusSelect = document.getElementById('addClientStatus');
    if (statusSelect) statusSelect.value = 'ativo';
}

/**
 * Fecha o modal de adicionar cliente
 */
export function closeAddClientModal() {
    const modal = document.getElementById('addClientModal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Limpar formulário
    const form = document.getElementById('addClientForm');
    if (form) form.reset();
}

/**
 * Fecha o modal de editar cliente
 */
export function closeEditClientModal() {
    const modal = document.getElementById('editClientModal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Limpar formulário
    const form = document.getElementById('editClientForm');
    if (form) form.reset();
}

/**
 * Abre o modal rápido de cliente
 * @param {string} context - Contexto: 'add', 'edit', 'unpaid'
 */
export function openQuickClientModal(context) {
    window.currentQuickClientContext = context;
    const modal = document.getElementById('quickClientModal');
    if (modal) {
        modal.style.display = 'block';
    }

    // Limpar formulário
    const form = document.getElementById('quickClientForm');
    if (form) form.reset();

    // Focar no campo nome
    setTimeout(() => {
        const nomeField = document.getElementById('quickClientNome');
        if (nomeField) nomeField.focus();
    }, 100);
}

/**
 * Fecha o modal rápido de cliente
 */
export function closeQuickClientModal() {
    const modal = document.getElementById('quickClientModal');
    if (modal) {
        modal.style.display = 'none';
    }
    window.currentQuickClientContext = null;

    // Limpar formulário
    const form = document.getElementById('quickClientForm');
    if (form) form.reset();
}

// =====================================================
// HANDLER DE SLOT DE HORÁRIO
// =====================================================

/**
 * Handler para clique em slot de horário na grade
 * @param {string} time - Horário clicado (HH:MM)
 * @param {string} date - Data (YYYY-MM-DD)
 * @param {string} isOccupied - "true" ou "false"
 */
export function handleTimeSlotClick(time, date, isOccupied) {
    if (isOccupied === 'true') {
        showNotification('Este horário já está ocupado', 'warning');
        return;
    }

    // Abrir modal de agendamento com horário pré-selecionado
    document.getElementById('addData').value = date;
    document.getElementById('addHorarioInicio').value = time;

    // Calcular horário de fim (30 min depois por padrão)
    const endTime = calculateEndTime(time, 30);
    document.getElementById('addHorarioFim').value = endTime;

    document.getElementById('addNome').value = '';
    document.getElementById('addTelefone').value = '';
    document.getElementById('addServico').value = '';
    document.getElementById('addPreco').value = '';
    document.getElementById('addStatus').value = 'agendado';
    document.getElementById('addObservacoes').value = '';

    // Mostrar modal de adicionar agendamento
    document.getElementById('addModal').style.display = 'block';

    showNotification(`Horário ${time} selecionado para agendamento`, 'success');
}

// =====================================================
// SETUP DE EVENTOS DO MODAL
// =====================================================

/**
 * Configura fechamento de modais ao clicar fora
 */
export function setupModalCloseOnClickOutside() {
    window.onclick = function (event) {
        const modals = [
            'editModal',
            'addModal',
            'quickCompleteModal',
            'retroModal',
            'addUnpaidModal',
            'addClientModal',
            'editClientModal',
            'quickClientModal',
            'inadimplentePaymentModal'
        ];

        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    };
}
