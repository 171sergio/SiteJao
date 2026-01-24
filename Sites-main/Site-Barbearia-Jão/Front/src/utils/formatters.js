/**
 * @module utils/formatters
 * @description Funções utilitárias para formatação de telefone, horário e data
 */

// =====================================================
// DEBOUNCE - Otimização de performance
// =====================================================

/**
 * Cria uma função debounced que atrasa a execução
 * @param {Function} func - Função a executar
 * @param {number} wait - Tempo de espera em ms
 * @returns {Function}
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// =====================================================
// TELEFONE - Normalização e Formatação
// =====================================================

/**
 * Normaliza telefone removendo caracteres não numéricos
 * Retorna no formato 55XXXXXXXXXXX (13 dígitos)
 * @param {string} phone - Telefone a normalizar
 * @returns {string}
 */
export function normalizePhone(phone) {
    if (!phone) return '';

    // Remove todos os caracteres não numéricos
    let normalized = phone.replace(/\D/g, '');

    // Se tem 13 dígitos e começa com 55, está no formato correto
    if (normalized.length === 13 && normalized.startsWith('55')) {
        return normalized;
    }

    // Se tem 12 dígitos e começa com 55 (sem o 9), adiciona o 9
    if (normalized.length === 12 && normalized.startsWith('55')) {
        const ddd = normalized.substring(2, 4);
        const numero = normalized.substring(4);
        return '55' + ddd + '9' + numero;
    }

    // Se tem 11 dígitos (DDD + 9 + número), adiciona o 55
    if (normalized.length === 11) {
        return '55' + normalized;
    }

    // Se tem 10 dígitos (DDD + número sem 9), adiciona 55 e o 9
    if (normalized.length === 10) {
        const ddd = normalized.substring(0, 2);
        const numero = normalized.substring(2);
        return '55' + ddd + '9' + numero;
    }

    // Se tem 9 dígitos, adiciona 55 + DDD padrão (31 - Belo Horizonte)
    if (normalized.length === 9) {
        return '5531' + normalized;
    }

    // Se tem 8 dígitos, adiciona 55 + DDD + 9
    if (normalized.length === 8) {
        return '55319' + normalized;
    }

    // Retorna com 55 na frente se não tiver
    if (!normalized.startsWith('55') && normalized.length >= 11) {
        return '55' + normalized;
    }

    return normalized;
}

/**
 * Formata telefone para exibição: +55 (XX) XXXXX-XXXX
 * @param {string} phone - Telefone a formatar
 * @returns {string}
 */
export function formatPhoneDisplay(phone) {
    const normalized = normalizePhone(phone);

    // Formato com 55: 5531992936893 (13 dígitos)
    if (normalized.length === 13 && normalized.startsWith('55')) {
        const ddd = normalized.substring(2, 4);
        const firstPart = normalized.substring(4, 9);
        const secondPart = normalized.substring(9);
        return `+55 (${ddd}) ${firstPart}-${secondPart}`;
    }

    // Formato sem 55: 31992936893 (11 dígitos)
    if (normalized.length === 11) {
        const ddd = normalized.substring(0, 2);
        const firstPart = normalized.substring(2, 7);
        const secondPart = normalized.substring(7);
        return `(${ddd}) ${firstPart}-${secondPart}`;
    }

    return phone; // Retorna original se não conseguir formatar
}

/**
 * Compara dois telefones (verifica se são o mesmo número)
 * @param {string} phone1 
 * @param {string} phone2 
 * @returns {boolean}
 */
export function phonesMatch(phone1, phone2) {
    const normalized1 = normalizePhone(phone1);
    const normalized2 = normalizePhone(phone2);
    return normalized1 === normalized2;
}

/**
 * Formata telefone para o padrão do banco
 * @param {string} telefone 
 * @returns {string}
 */
export function formatarTelefone(telefone) {
    if (!telefone) return '';

    const apenasNumeros = telefone.replace(/\D/g, '');

    // Se tiver 11 dígitos (sem o 55), formata
    if (apenasNumeros.length === 11) {
        return '55 ' + apenasNumeros.substring(0, 2) + ' ' +
            apenasNumeros.substring(2, 7) + '-' +
            apenasNumeros.substring(7);
    }

    // Se já começar com 55
    if (apenasNumeros.length === 13 && apenasNumeros.startsWith('55')) {
        return apenasNumeros.substring(0, 2) + ' ' +
            apenasNumeros.substring(2, 4) + ' ' +
            apenasNumeros.substring(4, 9) + '-' +
            apenasNumeros.substring(9);
    }

    // Se tiver 10 dígitos (sem o 9), adiciona o 9 e formata
    if (apenasNumeros.length === 10) {
        return '55 ' + apenasNumeros.substring(0, 2) + ' 9' +
            apenasNumeros.substring(2, 7) + '-' +
            apenasNumeros.substring(7);
    }

    return telefone;
}

/**
 * Monta telefone completo a partir dos campos separados
 * @param {string} prefix - Prefixo (não usado, mantido para compatibilidade)
 * @param {string} dddId - ID do campo DDD
 * @param {string} numeroId - ID do campo número
 * @returns {string}
 */
export function montarTelefone(prefix, dddId, numeroId) {
    const ddd = document.getElementById(dddId)?.value.replace(/\D/g, '') || '';
    const numero = document.getElementById(numeroId)?.value.replace(/\D/g, '') || '';

    if (!ddd || !numero || numero.length < 8) {
        return '';
    }

    // Formato: 55 XX 9XXXX-XXXX
    const numeroFormatado = numero.substring(0, 4) + '-' + numero.substring(4, 8);
    return `55 ${ddd} 9${numeroFormatado}`;
}

/**
 * Desmembra um telefone existente nos campos separados
 * @param {string} telefone - Telefone completo
 * @param {string} dddId - ID do campo DDD
 * @param {string} numeroId - ID do campo número
 */
export function desmembrarTelefone(telefone, dddId, numeroId) {
    if (!telefone) return;

    const apenasNumeros = telefone.replace(/\D/g, '');

    let ddd = '';
    let numero = '';

    // Formato esperado: 55XXXXXXXXXXX (13 dígitos) ou XXXXXXXXXXX (11 dígitos)
    if (apenasNumeros.length >= 11) {
        if (apenasNumeros.startsWith('55') && apenasNumeros.length >= 13) {
            // 55 + DDD + 9 + 8 dígitos
            ddd = apenasNumeros.substring(2, 4);
            numero = apenasNumeros.substring(5, 13); // Pega os 8 dígitos após o 9
        } else if (apenasNumeros.length === 11) {
            // DDD + 9 + 8 dígitos
            ddd = apenasNumeros.substring(0, 2);
            numero = apenasNumeros.substring(3, 11); // Pega os 8 dígitos após o 9
        } else {
            // Tenta extrair o que der
            ddd = apenasNumeros.substring(0, 2);
            numero = apenasNumeros.substring(2);
        }
    }

    // Formata número com hífen: XXXX-XXXX
    if (numero.length === 8) {
        numero = numero.substring(0, 4) + '-' + numero.substring(4);
    }

    const dddEl = document.getElementById(dddId);
    const numeroEl = document.getElementById(numeroId);

    if (dddEl) dddEl.value = ddd;
    if (numeroEl) numeroEl.value = numero;
}

/**
 * Formata o número enquanto digita (adiciona hífen automaticamente)
 * @param {HTMLInputElement} input 
 */
export function formatarNumeroDigitando(input) {
    let valor = input.value.replace(/\D/g, '');

    if (valor.length > 4) {
        valor = valor.substring(0, 4) + '-' + valor.substring(4, 8);
    }

    input.value = valor;
}

// =====================================================
// HORÁRIO - Formatação e Cálculos
// =====================================================

/**
 * Formata horário para HH:MM (remove segundos se houver)
 * @param {string} timeString 
 * @returns {string}
 */
export function formatTimeHHMM(timeString) {
    if (!timeString) return '';

    // Se já está no formato HH:MM, retorna como está
    if (timeString.match(/^\d{1,2}:\d{2}$/)) {
        return timeString;
    }

    // Se tem segundos (HH:MM:SS), remove os segundos
    if (timeString.includes(':') && timeString.split(':').length === 3) {
        return timeString.substring(0, 5);
    }

    // Se é um objeto Date ou timestamp, converte para HH:MM
    try {
        const date = new Date(timeString);
        if (!isNaN(date.getTime())) {
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        }
    } catch (e) {
        console.warn('Erro ao formatar horário:', timeString, e);
    }

    return timeString;
}

/**
 * Calcula horário de fim baseado no início e duração
 * @param {string} startTime - Horário de início (HH:MM)
 * @param {number} durationMinutes - Duração em minutos
 * @returns {string}
 */
export function calculateEndTime(startTime, durationMinutes = 30) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const endTime = new Date();
    endTime.setHours(hours, minutes + durationMinutes, 0, 0);
    const endHours = endTime.getHours().toString().padStart(2, '0');
    const endMinutes = endTime.getMinutes().toString().padStart(2, '0');
    return `${endHours}:${endMinutes}`;
}

/**
 * Obtém horário formatado de um agendamento
 * @param {Object} appointment 
 * @returns {string}
 */
export function getFormattedTime(appointment) {
    if (appointment.horario_inicio) {
        return formatTimeHHMM(appointment.horario_inicio);
    }

    if (appointment.data_horario) {
        const appointmentDate = new Date(appointment.data_horario);
        const hours = appointmentDate.getHours().toString().padStart(2, '0');
        const minutes = appointmentDate.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    return '';
}

/**
 * Calcula todos os slots de 15 minutos ocupados durante um período
 * @param {string} startTime - Horário início (HH:MM)
 * @param {string} endTime - Horário fim (HH:MM)
 * @returns {string[]}
 */
export function getOccupiedTimeSlots(startTime, endTime) {
    const slots = [];

    if (!startTime) {
        return slots;
    }

    // Se não tem horário de fim, assumir 30 minutos
    if (!endTime) {
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDate = new Date();
        startDate.setHours(hours, minutes, 0, 0);
        const endDate = new Date(startDate.getTime() + 30 * 60000);
        endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
    }

    // Converter horários para minutos
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);

    const startTotalMinutes = startHours * 60 + startMinutes;
    const endTotalMinutes = endHours * 60 + endMinutes;

    // Gerar todos os slots de 15 minutos no período
    for (let minutes = startTotalMinutes; minutes < endTotalMinutes; minutes += 15) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        const timeSlot = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
        slots.push(timeSlot);
    }

    return slots;
}

/**
 * Gera slots de 15 minutos entre dois horários (inclusive o final)
 * @param {string} horaInicio - Horário início (HH:MM)
 * @param {string} horaFim - Horário fim (HH:MM)
 * @returns {string[]}
 */
export function generate15MinSlots(horaInicio, horaFim) {
    const toMins = h => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; };
    const fromMins = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const start = toMins(horaInicio), end = toMins(horaFim);
    const slots = [];
    for (let t = start; t <= end; t += 15) slots.push(fromMins(t));
    return slots;
}

// =====================================================
// DATA - Formatação
// =====================================================

/**
 * Formata data para exibição (DD/MM/YYYY)
 * @param {string|Date} dateString 
 * @returns {string}
 */
export function formatDate(dateString) {
    if (!dateString) return 'N/A';

    try {
        let date;

        if (dateString instanceof Date) {
            date = dateString;
        } else if (typeof dateString === 'string' && dateString.includes('T')) {
            date = new Date(dateString);
        } else if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
            date = new Date(dateString + 'T00:00:00');
        } else {
            date = new Date(dateString);
        }

        if (isNaN(date.getTime())) {
            return 'Data inválida';
        }

        return date.toLocaleDateString('pt-BR');
    } catch (error) {
        console.error('Erro ao formatar data:', error, dateString);
        return 'Data inválida';
    }
}

/**
 * Retorna a data atual formatada para input type="date"
 * @returns {string} YYYY-MM-DD
 */
export function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Retorna a data de amanhã formatada para input type="date"
 * @returns {string} YYYY-MM-DD
 */
export function getTomorrowDateString() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
}
