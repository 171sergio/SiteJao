/**
 * @module ui/notifications
 * @description Sistema de notificações e indicadores de carregamento
 */

// =====================================================
// NOTIFICAÇÕES
// =====================================================

/**
 * Exibe uma notificação toast na tela
 * @param {string} message - Mensagem da notificação
 * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
 */
export function showNotification(message, type = 'info') {
    // Remover notificação existente se houver
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Criar elemento de notificação
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    // Adicionar ao body
    document.body.appendChild(notification);

    // Remover após 3 segundos
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

// =====================================================
// LOADING OVERLAY
// =====================================================

/**
 * Exibe o overlay de carregamento
 */
export function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

/**
 * Oculta o overlay de carregamento
 */
export function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// =====================================================
// CONFIRMAÇÕES
// =====================================================

/**
 * Exibe uma confirmação customizada (pode ser estendida para modal)
 * @param {string} message - Mensagem de confirmação
 * @returns {boolean}
 */
export function confirmAction(message) {
    return confirm(message);
}

/**
 * Exibe uma confirmação de exclusão
 * @param {string} itemName - Nome do item a excluir
 * @param {string} itemType - Tipo do item (cliente, agendamento, etc)
 * @returns {boolean}
 */
export function confirmDelete(itemName, itemType = 'item') {
    return confirm(`Tem certeza que deseja excluir ${itemType === 'item' ? 'este' : 'o'} ${itemType} "${itemName}"?\n\nEsta ação não pode ser desfeita.`);
}
