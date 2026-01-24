/**
 * @module ui/renderers
 * @description Funções de renderização de tabelas, listas e grids
 */

import { formatDate, formatPhoneDisplay, formatTimeHHMM, getFormattedTime, getOccupiedTimeSlots, generate15MinSlots } from '../utils/formatters.js';
import { PAYMENT_FEES, calculateNetValue } from '../logic/finance.js';

// =====================================================
// TABELA DE AGENDAMENTOS
// =====================================================

/**
 * Renderiza a tabela de agendamentos
 * 
 * IMPORTANTE - ATRIBUTO data-label:
 * Cada <td> DEVE ter o atributo data-label correspondente ao cabeçalho da coluna.
 * Este atributo é essencial para o layout responsivo em dispositivos móveis.
 * O CSS usa td::before { content: attr(data-label) } para exibir o título da coluna
 * quando a tabela é convertida em cards empilhados verticalmente.
 * 
 * @param {Array} appointments - Lista de agendamentos
 */
export function renderAppointmentsTable(appointments) {
    const tbody = document.getElementById('appointmentsTableBody');
    if (!tbody) return;

    // Estado vazio - não precisa de data-label pois é colspan
    if (!appointments || appointments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 2rem; color: rgba(255, 255, 255, 0.6);">
                    <i class="fas fa-calendar-times" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <br>
                    Nenhum agendamento encontrado
                </td>
            </tr>
        `;
        return;
    }

    // Mapeamento de colunas para data-label (garante consistência)
    // Colunas: Cliente | Telefone | Serviço | Data | Horário | Preço | Status | Ações
    tbody.innerHTML = appointments.map(apt => {
        const horarioFormatado = apt.horario_inicio && apt.horario_fim
            ? `${formatTimeHHMM(apt.horario_inicio)} - ${formatTimeHHMM(apt.horario_fim)}`
            : getFormattedTime(apt);

        const statusClass = getStatusClass(apt.status);
        const statusLabel = getStatusLabel(apt.status);
        const preco = parseFloat(apt.preco) || parseFloat(apt.preco_cobrado) || 0;

        // Cada <td> OBRIGATORIAMENTE tem data-label para responsividade
        return `
            <tr data-id="${apt.id}">
                <td data-label="Cliente">${apt.cliente_nome || 'N/A'}</td>
                <td data-label="Telefone">${formatPhoneDisplay(apt.telefone)}</td>
                <td data-label="Serviço">${apt.servico || 'N/A'}</td>
                <td data-label="Data">${formatDate(apt.data_horario?.split('T')[0])}</td>
                <td data-label="Horário">${horarioFormatado}</td>
                <td data-label="Preço">R$ ${preco.toFixed(2)}</td>
                <td data-label="Status"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td data-label="Ações">
                    <div class="action-buttons">
                        <button class="btn-complete" data-action="complete" data-id="${apt.id}" title="Concluir Rápido">
                            <i class="fas fa-check-circle"></i>
                        </button>
                        <button class="btn-edit" data-action="edit-appointment" data-id="${apt.id}" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" data-action="delete-appointment" data-id="${apt.id}" title="Excluir">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// =====================================================
// LISTA DE AGENDAMENTOS DO DIA
// =====================================================

/**
 * Renderiza a lista/cards de agendamentos do dia (overview)
 * @param {Array} appointments - Lista de agendamentos do dia
 */
export function renderTodaySchedule(appointments) {
    const container = document.getElementById('todayScheduleList');
    if (!container) return;

    if (!appointments || appointments.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-calendar-check"></i>
                <p>Nenhum agendamento para hoje</p>
            </div>
        `;
        return;
    }

    container.innerHTML = appointments.map(apt => {
        const horarioFormatado = apt.horario_inicio
            ? formatTimeHHMM(apt.horario_inicio)
            : getFormattedTime(apt);

        const statusClass = getStatusClass(apt.status);
        const preco = parseFloat(apt.preco) || parseFloat(apt.preco_cobrado) || 0;

        return `
            <div class="schedule-item ${statusClass}" data-id="${apt.id}">
                <div class="schedule-time">${horarioFormatado}</div>
                <div class="schedule-info">
                    <div class="schedule-client">${apt.cliente_nome || 'Cliente'}</div>
                    <div class="schedule-service">${apt.servico || 'Serviço'}</div>
                </div>
                <div class="schedule-price">R$ ${preco.toFixed(2)}</div>
                <div class="schedule-actions">
                    <button class="btn-sm btn-complete" data-action="complete" data-id="${apt.id}" title="Concluir">
                        <i class="fas fa-check"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// =====================================================
// GRADE DE HORÁRIOS
// =====================================================

/**
 * Renderiza a grade visual de horários
 * @param {Array} appointments - Agendamentos do dia
 * @param {string} selectedDate - Data selecionada (YYYY-MM-DD)
 * @param {Object} options - Opções de exibição
 */
export function renderScheduleGrid(appointments, selectedDate, options = {}) {
    const container = document.getElementById('scheduleGrid');
    if (!container) return;

    // Configuração de horários
    const workStart = options.workStart || 8;  // 8h
    const workEnd = options.workEnd || 20;     // 20h
    const slotDuration = options.slotDuration || 15; // 15 min

    // Gerar todos os slots de horário
    const allSlots = [];
    for (let hour = workStart; hour < workEnd; hour++) {
        for (let min = 0; min < 60; min += slotDuration) {
            const timeString = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
            allSlots.push(timeString);
        }
    }

    // Mapear horários ocupados
    const occupiedSlots = new Map();
    (appointments || []).forEach(apt => {
        const slots = getOccupiedTimeSlots(apt.horario_inicio, apt.horario_fim);
        slots.forEach(slot => {
            occupiedSlots.set(slot, apt);
        });
    });

    // Aplicar filtro de turno
    const shiftFilter = options.shiftFilter || 'all';
    let filteredSlots = allSlots;

    if (shiftFilter === 'morning') {
        filteredSlots = allSlots.filter(s => parseInt(s.split(':')[0]) < 12);
    } else if (shiftFilter === 'afternoon') {
        filteredSlots = allSlots.filter(s => {
            const hour = parseInt(s.split(':')[0]);
            return hour >= 12 && hour < 18;
        });
    } else if (shiftFilter === 'evening') {
        filteredSlots = allSlots.filter(s => parseInt(s.split(':')[0]) >= 18);
    }

    // Renderizar grid
    container.innerHTML = filteredSlots.map(time => {
        const isOccupied = occupiedSlots.has(time);
        const apt = occupiedSlots.get(time);

        if (isOccupied && apt) {
            // Só exibe detalhes no primeiro slot do agendamento
            const isFirstSlot = formatTimeHHMM(apt.horario_inicio) === time;

            if (isFirstSlot) {
                const statusClass = getStatusClass(apt.status);
                return `
                    <div class="time-slot occupied ${statusClass}" 
                         data-action="edit-appointment"
                         data-id="${apt.id}"
                         title="${apt.cliente_nome} - ${apt.servico}">
                        <span class="slot-time">${time}</span>
                        <span class="slot-client">${apt.cliente_nome || 'Cliente'}</span>
                        <span class="slot-service">${apt.servico || ''}</span>
                    </div>
                `;
            } else {
                return `
                    <div class="time-slot occupied continuation" 
                         data-action="edit-appointment"
                         data-id="${apt.id}">
                    </div>
                `;
            }
        }

        return `
            <div class="time-slot available" 
                 data-action="time-slot-click"
                 data-time="${time}"
                 data-date="${selectedDate}"
                 data-occupied="false">
                <span class="slot-time">${time}</span>
                <span class="slot-available">Disponível</span>
            </div>
        `;
    }).join('');
}

// =====================================================
// TABELA DE CLIENTES
// =====================================================

/**
 * Renderiza a tabela de clientes
 * 
 * IMPORTANTE - ATRIBUTO data-label:
 * Cada <td> DEVE ter o atributo data-label correspondente ao cabeçalho da coluna.
 * Este atributo é essencial para o layout responsivo em dispositivos móveis.
 * O CSS usa td::before { content: attr(data-label) } para exibir o título da coluna
 * quando a tabela é convertida em cards empilhados verticalmente.
 * 
 * @param {Array} clients - Lista de clientes
 */
export function renderClientsTable(clients) {
    const tableBody = document.querySelector('#clientsTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    // Estado vazio - não precisa de data-label pois é colspan
    if (!clients || clients.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">
                    Nenhum cliente encontrado
                </td>
            </tr>
        `;
        return;
    }

    // Mapeamento de colunas para data-label (garante consistência)
    // Colunas: Nome | Telefone | Status | Agendamentos | Último Agendamento | Cadastro | Ações
    clients.forEach(client => {
        const totalAgendamentos = client.totalAgendamentos || 0;
        const ultimoAgendamentoFormatado = client.ultimoAgendamento
            ? formatDate(client.ultimoAgendamento)
            : 'Nunca';

        const statusClass = client.status_cliente === 'ativo' ? 'status-active' :
            client.status_cliente === 'inativo' ? 'status-inactive' : 'status-blocked';

        const telefoneFormatado = formatPhoneDisplay(client.telefone);

        const row = document.createElement('tr');
        row.dataset.id = client.id;
        row.dataset.nome = client.nome;
        row.dataset.telefone = client.telefone || '';

        // Cada <td> OBRIGATORIAMENTE tem data-label para responsividade
        row.innerHTML = `
            <td data-label="Nome">${client.nome}</td>
            <td data-label="Telefone">${telefoneFormatado}</td>
            <td data-label="Status"><span class="status-badge ${statusClass}">${client.status_cliente || 'ativo'}</span></td>
            <td data-label="Agendamentos">${totalAgendamentos}</td>
            <td data-label="Último Agendamento">${ultimoAgendamentoFormatado}</td>
            <td data-label="Cadastro">${formatDate(client.criado_em)}</td>
            <td data-label="Ações">
                <div class="action-buttons">
                    <button class="btn-edit" data-action="edit-client" data-id="${client.id}" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-delete" data-action="delete-client" data-id="${client.id}" data-nome="${client.nome}" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                    <button class="btn-contact" data-action="contact-client" data-telefone="${client.telefone}" data-nome="${client.nome}" title="Contatar">
                        <i class="fab fa-whatsapp"></i>
                    </button>
                </div>
            </td>
        `;

        tableBody.appendChild(row);
    });
}

// =====================================================
// GRID DE CLIENTES (CARDS)
// =====================================================

/**
 * Renderiza o grid de cards de clientes
 * @param {Array} clients - Lista de clientes
 */
export function renderClientsGrid(clients) {
    const container = document.getElementById('clientsGrid');
    if (!container) return;

    container.innerHTML = '';

    clients.forEach(client => {
        const card = document.createElement('div');
        card.className = 'client-card';

        const formattedPhone = formatPhoneDisplay(client.telefone);

        card.innerHTML = `
            <div class="client-header">
                <h4>${client.nome}</h4>
                <button class="client-delete-btn" 
                        data-action="delete-client" 
                        data-id="${client.id}" 
                        data-nome="${client.nome}" 
                        title="Excluir Cliente">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="client-info">
                <p><strong>Telefone:</strong> <span class="client-phone">${formattedPhone}</span></p>
                <p><strong>Total de Agendamentos:</strong> ${client.totalAgendamentos || 0}</p>
                <p><strong>Último Agendamento:</strong> ${client.ultimoAgendamento ? formatDate(client.ultimoAgendamento) : 'Nunca'}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

// =====================================================
// TABELA DE INADIMPLENTES
// =====================================================

/**
 * Renderiza a tabela de inadimplentes
 * 
 * IMPORTANTE - ATRIBUTO data-label:
 * Cada <td> DEVE ter o atributo data-label correspondente ao cabeçalho da coluna.
 * Este atributo é essencial para o layout responsivo em dispositivos móveis.
 * O CSS usa td::before { content: attr(data-label) } para exibir o título da coluna
 * quando a tabela é convertida em cards empilhados verticalmente.
 * 
 * @param {Array} unpaidClients - Lista de inadimplentes
 */
export function renderUnpaidTable(unpaidClients) {
    const tbody = document.getElementById('unpaidTableBody');
    if (!tbody) return;

    // Estado vazio - não precisa de data-label pois é colspan
    if (!unpaidClients || unpaidClients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: rgba(255, 255, 255, 0.6);">
                    <i class="fas fa-check-circle" style="font-size: 2rem; margin-bottom: 1rem; color: #4CAF50;"></i>
                    <br>
                    Nenhum cliente inadimplente encontrado!
                </td>
            </tr>
        `;
        return;
    }

    // Mapeamento de colunas para data-label (garante consistência)
    // Colunas: Cliente | Telefone | Serviço | Data | Valor | Atraso | Ações
    tbody.innerHTML = unpaidClients.map(client => {
        const hasAgendamento = client.agendamentos && client.agendamentos.data_horario;

        const serviceDate = hasAgendamento
            ? new Date(client.agendamentos.data_horario)
            : new Date(client.data_vencimento + 'T00:00:00');

        const clienteNome = client.clientes?.nome || client.nome_cliente || 'Cliente não identificado';
        const clienteTelefone = client.clientes?.telefone || client.telefone || '';

        const servicoNome = hasAgendamento && client.agendamentos.servicos?.nome
            ? client.agendamentos.servicos.nome
            : (client.servico || 'Serviço não especificado');

        const overdueClass = client.dias_atraso > 30 ? 'critical' : '';

        const inadimplenteId = client.id;
        const agendamentoId = client.agendamento_id;

        // Cada <td> OBRIGATORIAMENTE tem data-label para responsividade
        return `
            <tr data-id="${inadimplenteId}" data-agendamento-id="${agendamentoId || ''}" data-nome="${clienteNome}" data-telefone="${clienteTelefone}">
                <td data-label="Cliente">${clienteNome}</td>
                <td data-label="Telefone">${formatPhoneDisplay(clienteTelefone)}</td>
                <td data-label="Serviço">${servicoNome}</td>
                <td data-label="Data">${serviceDate.toLocaleDateString('pt-BR')}</td>
                <td data-label="Valor">R$ ${(client.valor_devido || 0).toFixed(2)}</td>
                <td data-label="Atraso">
                    <span class="overdue-days ${overdueClass}">
                        ${client.dias_atraso || 0} dias
                    </span>
                </td>
                <td data-label="Ações">
                    <div class="unpaid-actions">
                        <button class="mark-paid-btn" data-action="mark-paid" data-id="${inadimplenteId}">
                            <i class="fas fa-check"></i>
                            Marcar Pago
                        </button>
                        <button class="btn-edit" data-action="edit-unpaid" data-id="${inadimplenteId}">
                            <i class="fas fa-edit"></i>
                            Editar
                        </button>
                        <button class="btn-delete" data-action="delete-unpaid" data-id="${inadimplenteId}">
                            <i class="fas fa-trash"></i>
                            Excluir
                        </button>
                        <button class="contact-btn" data-action="contact-unpaid" data-telefone="${clienteTelefone}" data-nome="${clienteNome}" data-agendamento-id="${agendamentoId || ''}">
                            <i class="fas fa-phone"></i>
                            Contatar
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Atualiza o resumo de inadimplentes
 * @param {Array} unpaidClients - Lista de inadimplentes
 */
export function updateUnpaidSummary(unpaidClients) {
    const totalClients = unpaidClients.length;
    const totalAmount = unpaidClients.reduce((sum, client) => {
        const valor = client.valor_devido || client.preco_cobrado || 0;
        return sum + parseFloat(valor);
    }, 0);

    const totalClientsEl = document.getElementById('totalUnpaidClients');
    const totalAmountEl = document.getElementById('totalUnpaidAmount');

    if (totalClientsEl) totalClientsEl.textContent = totalClients;
    if (totalAmountEl) totalAmountEl.textContent = `R$ ${totalAmount.toFixed(2)}`;
}

// =====================================================
// HELPERS PRIVADOS
// =====================================================

/**
 * Retorna classe CSS para o status
 * @param {string} status 
 * @returns {string}
 */
function getStatusClass(status) {
    switch (status) {
        case 'confirmado': return 'status-confirmed';
        case 'concluido': return 'status-completed';
        case 'cancelado': return 'status-cancelled';
        case 'agendado':
        default: return 'status-pending';
    }
}

/**
 * Retorna label traduzido para o status
 * @param {string} status 
 * @returns {string}
 */
function getStatusLabel(status) {
    switch (status) {
        case 'confirmado': return 'Confirmado';
        case 'concluido': return 'Concluído';
        case 'cancelado': return 'Cancelado';
        case 'agendado':
        default: return 'Agendado';
    }
}
