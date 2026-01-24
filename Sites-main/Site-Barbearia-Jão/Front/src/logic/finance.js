/**
 * @module logic/finance
 * @description Lógica financeira: taxas InfinitePay e cálculo de valor líquido
 */

// =====================================================
// INFINITEPAY - Configuração de Taxas
// =====================================================
export const PAYMENT_FEES = {
    'dinheiro': 0,
    'pix': 0,
    'debito': 1.38,
    'credito_vista': 3.16,
    'credito_parcelado': 12.41
};

/**
 * Calcula o valor líquido após descontar a taxa da maquininha
 * @param {number} grossValue - Valor bruto cobrado
 * @param {string} paymentMethod - Método de pagamento (chave de PAYMENT_FEES)
 * @returns {number} Valor líquido (após taxa)
 */
export function calculateNetValue(grossValue, paymentMethod) {
    const feePercent = PAYMENT_FEES[paymentMethod] || 0;
    const fee = grossValue * (feePercent / 100);
    return grossValue - fee;
}


