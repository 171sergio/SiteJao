/**
 * @module logic/validators
 * @description Funções de validação de dados para agendamentos e formulários
 */

/**
 * Valida os dados de um agendamento
 * @param {Object} data - Dados do agendamento
 * @param {string} data.nome - Nome do cliente
 * @param {string} data.servico - Serviço selecionado
 * @param {string} data.data - Data do agendamento (YYYY-MM-DD)
 * @param {string} data.horarioInicio - Horário de início (HH:MM)
 * @param {string} data.horarioFim - Horário de fim (HH:MM)
 * @param {number} data.preco - Preço do serviço
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAppointmentData(data) {
    const errors = [];

    if (!data.nome || data.nome.trim().length < 2) {
        errors.push('Nome do cliente deve ter pelo menos 2 caracteres.');
    }

    // Telefone agora é OPCIONAL - não validamos mais como obrigatório

    if (!data.servico) {
        errors.push('Selecione um serviço.');
    }

    if (!data.data) {
        errors.push('Selecione uma data.');
    }

    if (!data.horarioInicio || !data.horarioFim) {
        errors.push('Preencha os horários de início e fim.');
    }

    if (data.horarioInicio && data.horarioFim && data.horarioFim <= data.horarioInicio) {
        errors.push('Horário de fim deve ser posterior ao de início.');
    }

    if (!data.preco || data.preco <= 0) {
        errors.push('Informe o preço do serviço.');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Valida formato de horário (HH:MM)
 * @param {string} time - Horário a validar
 * @returns {boolean}
 */
export function validateTimeFormat(time) {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
}

/**
 * Valida se o horário de fim é posterior ao de início
 * @param {string} startTime - Horário de início (HH:MM)
 * @param {string} endTime - Horário de fim (HH:MM)
 * @returns {boolean}
 */
export function validateTimeRange(startTime, endTime) {
    if (!startTime || !endTime) return false;
    return endTime > startTime;
}
