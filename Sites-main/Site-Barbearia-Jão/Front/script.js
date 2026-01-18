// Configuração do Supabase
let supabaseClient = null;
let isSupabaseConfigured = false;

// =====================================================
// INFINITEPAY - Configuração de Taxas
// =====================================================
const PAYMENT_FEES = {
    'dinheiro': 0,
    'pix': 0,
    'debito': 1.38,
    'credito_vista': 3.16,
    'credito_parcelado': 12.41
};

// Calcula o valor líquido após descontar a taxa
function calculateNetValue(grossValue, paymentMethod) {
    const feePercent = PAYMENT_FEES[paymentMethod] || 0;
    const fee = grossValue * (feePercent / 100);
    return grossValue - fee;
}

// Mostra/esconde o campo de forma de pagamento baseado no status
function togglePaymentMethodVisibility(prefix) {
    const statusSelect = document.getElementById(`${prefix}Status`);
    const paymentGroup = document.getElementById(`${prefix}PaymentMethodGroup`);
    if (statusSelect && paymentGroup) {
        paymentGroup.style.display = statusSelect.value === 'concluido' ? 'block' : 'none';
    }
}

// =====================================================
// CONCLUSÃO RÁPIDA - Modal para concluir e definir pagamento
// =====================================================
let quickCompleteAppointment = null;

function openQuickCompleteModal(appointmentId) {
    // Buscar dados do agendamento
    const appointment = [...appointments, ...todayAppointments].find(a =>
        (a.id || a.agendamento_id) == appointmentId
    );

    if (!appointment) {
        showNotification('Agendamento não encontrado', 'error');
        return;
    }

    quickCompleteAppointment = appointment;

    const clienteNome = appointment.cliente_nome || appointment.nome_cliente || 'Cliente';
    const servico = appointment.servico || appointment.servico_nome || 'Serviço';
    const preco = parseFloat(appointment.preco_cobrado || appointment.preco || 0);

    // Preencher info do agendamento
    document.getElementById('quickCompleteId').value = appointmentId;
    document.getElementById('quickCompleteInfo').innerHTML = `
        <div class="client-name">${clienteNome}</div>
        <div class="service-info">${servico}</div>
        <div class="price-info">R$ ${preco.toFixed(2)}</div>
    `;

    // Atualizar resumo inicial
    updateQuickCompleteSummary();

    // Adicionar listener para atualizar quando mudar pagamento
    document.getElementById('quickCompletePayment').addEventListener('change', updateQuickCompleteSummary);

    // Mostrar modal
    document.getElementById('quickCompleteModal').style.display = 'block';
}

function updateQuickCompleteSummary() {
    if (!quickCompleteAppointment) return;

    const preco = parseFloat(quickCompleteAppointment.preco_cobrado || quickCompleteAppointment.preco || 0);
    const paymentMethod = document.getElementById('quickCompletePayment').value;

    if (paymentMethod === 'nao_pago') {
        document.getElementById('quickCompleteSummary').innerHTML = `
            <div class="net-value" style="color: #ff4444;">Cliente Devedor (Inadimplente)</div>
            <div class="fee-info">O valor será pendurado na conta do cliente.</div>
        `;
        return;
    }

    const feePercent = PAYMENT_FEES[paymentMethod] || 0;
    const feeValue = preco * (feePercent / 100);
    const netValue = preco - feeValue;

    document.getElementById('quickCompleteSummary').innerHTML = `
        <div class="net-value">Você recebe: R$ ${netValue.toFixed(2)}</div>
        ${feePercent > 0 ? `<div class="fee-info">Taxa: R$ ${feeValue.toFixed(2)} (${feePercent}%)</div>` : '<div class="fee-info">Sem taxa!</div>'}
    `;
}

function closeQuickCompleteModal() {
    document.getElementById('quickCompleteModal').style.display = 'none';
    quickCompleteAppointment = null;
}

async function confirmQuickComplete() {
    if (!quickCompleteAppointment || !supabaseClient) {
        showNotification('Erro ao processar', 'error');
        return;
    }

    const appointmentId = document.getElementById('quickCompleteId').value;
    const paymentMethod = document.getElementById('quickCompletePayment').value;
    const preco = parseFloat(quickCompleteAppointment.preco_cobrado || quickCompleteAppointment.preco || 0);
    const isNaoPago = paymentMethod === 'nao_pago';

    try {
        showLoading();

        let updateData = {};

        if (isNaoPago) {
            updateData = {
                status: 'concluido',
                forma_pagamento: null, // Sem forma de pagamento definida
                valor_liquido: 0,
                taxa_aplicada: 0,
                valor_pago: 0,
                status_pagamento: 'nao_pago' // Marcado como não pago
            };
        } else {
            updateData = {
                status: 'concluido',
                forma_pagamento: paymentMethod,
                valor_liquido: calculateNetValue(preco, paymentMethod),
                taxa_aplicada: PAYMENT_FEES[paymentMethod] || 0,
                valor_pago: preco,
                status_pagamento: 'pago'
            };
        }

        const { error } = await supabaseClient
            .from('agendamentos')
            .update(updateData)
            .eq('id', parseInt(appointmentId));

        if (error) throw error;

        // Se "Não Pago", criar registro de inadimplente automaticamente
        if (isNaoPago) {
            // Extrair data do agendamento
            const dataAgendamento = quickCompleteAppointment.data_horario
                ? new Date(quickCompleteAppointment.data_horario).toISOString().split('T')[0]
                : new Date().toISOString().split('T')[0];

            await createInadimplenteFromAppointment({
                agendamentoId: parseInt(appointmentId),
                clienteId: quickCompleteAppointment.cliente_id || null,
                telefone: quickCompleteAppointment.telefone || '',
                nomeCliente: quickCompleteAppointment.cliente_nome || quickCompleteAppointment.nome_cliente || 'Cliente',
                servico: quickCompleteAppointment.servico || quickCompleteAppointment.servico_nome || 'Serviço',
                valorDevido: preco,
                dataVencimento: dataAgendamento,
                observacoes: 'Serviço concluído sem pagamento'
            });

            showNotification('Atendimento concluído e cliente adicionado aos inadimplentes!', 'warning');
        } else {
            showNotification('Atendimento concluído com sucesso!', 'success');
        }

        closeQuickCompleteModal();

        // Recarregar dados
        loadAppointments();
        loadTodayAppointments();
        loadOverviewData();
        if (isNaoPago) {
            loadUnpaidClients(); // Atualizar lista de inadimplentes
        }

    } catch (error) {
        console.error('Erro ao concluir atendimento:', error);
        showNotification('Erro ao concluir: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Expor função globalmente
window.openQuickCompleteModal = openQuickCompleteModal;

// =====================================================
// REGISTRO RETROATIVO - Cadastrar atendimentos passados
// =====================================================
function openRetroactiveModal() {
    const modal = document.getElementById('retroactiveModal');
    if (!modal) {
        showNotification('Modal não encontrado', 'error');
        return;
    }

    // Limpar formulário
    document.getElementById('retroactiveForm').reset();

    // Preencher select de serviços
    const servicoSelect = document.getElementById('retroServico');
    servicoSelect.innerHTML = '<option value="">Selecione...</option>';
    services.forEach(s => {
        servicoSelect.innerHTML += `<option value="${s.nome}" data-preco="${s.preco}">${s.nome}</option>`;
    });

    // Definir data de hoje como padrão
    document.getElementById('retroData').value = new Date().toISOString().split('T')[0];

    // Atualizar resumo inicial
    updateRetroSummary();

    modal.style.display = 'block';
}

function closeRetroactiveModal() {
    document.getElementById('retroactiveModal').style.display = 'none';
}

function updateRetroPrice() {
    const servicoSelect = document.getElementById('retroServico');
    const selectedOption = servicoSelect.options[servicoSelect.selectedIndex];
    const preco = selectedOption?.dataset?.preco || '';

    // Deixar campo em branco para o barbeiro definir o valor cobrado
    document.getElementById('retroPreco').focus();
    updateRetroSummary();
}

function updateRetroSummary() {
    const preco = parseFloat(document.getElementById('retroPreco').value) || 0;
    const paymentMethod = document.getElementById('retroPagamento').value;
    const summaryEl = document.getElementById('retroSummary');

    // Handle "Não Pago" case
    if (paymentMethod === 'nao_pago') {
        summaryEl.innerHTML = `
            <div class="net-value" style="color: #ff4444;">Cliente Devedor (Inadimplente)</div>
            <div class="fee-info">O valor será pendurado na conta do cliente.</div>
        `;
        return;
    }

    const feePercent = PAYMENT_FEES[paymentMethod] || 0;
    const feeValue = preco * (feePercent / 100);
    const netValue = preco - feeValue;

    if (preco > 0) {
        summaryEl.innerHTML = `
            <div class="net-value">Você recebe: R$ ${netValue.toFixed(2)}</div>
            ${feePercent > 0 ? `<div class="fee-info">Taxa da maquininha: R$ ${feeValue.toFixed(2)} (${feePercent}%)</div>` : '<div class="fee-info">✓ Sem taxa!</div>'}
        `;
    } else {
        summaryEl.innerHTML = '<div class="fee-info">Preencha o valor para ver o resumo</div>';
    }
}

async function saveRetroactiveAppointment(event) {
    event.preventDefault();

    if (!supabaseClient) {
        showNotification('Supabase não configurado', 'error');
        return;
    }

    try {
        showLoading();

        const clienteNome = document.getElementById('retroNome').value.trim();
        const ddd = document.getElementById('retroDDD').value.trim();
        const numero = document.getElementById('retroNumero').value.replace(/\D/g, '');
        const servico = document.getElementById('retroServico').value;
        const preco = parseFloat(document.getElementById('retroPreco').value) || 0;
        const data = document.getElementById('retroData').value;
        const horarioInicio = document.getElementById('retroHorarioInicio').value;
        const horarioFim = document.getElementById('retroHorarioFim').value;
        const formaPagamento = document.getElementById('retroPagamento').value;
        const observacoes = document.getElementById('retroObservacoes').value.trim();

        // Validações (horário é opcional)
        if (!clienteNome || !servico || !preco || !data) {
            showNotification('Preencha todos os campos obrigatórios', 'error');
            return;
        }

        // Montar telefone se preenchido
        let telefone = '';
        if (ddd && numero) {
            telefone = `55${ddd}${numero}`;
        }

        // Buscar ou criar cliente
        const cliente = await findOrCreateClient(telefone, clienteNome);
        if (!cliente) {
            throw new Error('Erro ao processar cliente');
        }

        // Buscar serviço
        const servicoData = services.find(s => s.nome === servico);

        // Montar timestamp para retroativo
        // Se não informou horário, gerar um timestamp único para evitar conflito de constraint
        let horaInicio, horaFim, dataHorario;
        let horarioNaoInformado = false;

        if (horarioInicio) {
            // Horário informado - usar normalmente
            horaInicio = horarioInicio;
            horaFim = horarioFim || horarioInicio;
            dataHorario = new Date(`${data}T${horaInicio}:00`);
        } else {
            // Horário NÃO informado - usar horário genérico com segundos aleatórios
            // Isso evita conflito de unique constraint no slot de horário
            // Usamos '00:00' como marcador de "horário não especificado"
            const randomMinutes = Math.floor(Math.random() * 59).toString().padStart(2, '0');
            const randomSeconds = Math.floor(Math.random() * 59).toString().padStart(2, '0');
            horaInicio = `00:${randomMinutes}`; // Marca como horário não especificado
            horaFim = `00:${randomMinutes}`;
            horarioNaoInformado = true;
            // Usar timestamp único para evitar conflitos
            dataHorario = new Date(`${data}T00:${randomMinutes}:${randomSeconds}`);
        }

        // Determinar valores financeiros baseado no método de pagamento
        const isNaoPago = formaPagamento === 'nao_pago';
        const valorLiquido = isNaoPago ? 0 : calculateNetValue(preco, formaPagamento);
        const taxaAplicada = isNaoPago ? 0 : (PAYMENT_FEES[formaPagamento] || 0);
        const valorPago = isNaoPago ? 0 : preco;
        const statusPagamento = isNaoPago ? 'nao_pago' : 'pago';
        const formaPagamentoFinal = isNaoPago ? null : formaPagamento;

        // Inserir diretamente como CONCLUÍDO (é retroativo)
        const appointmentData = {
            cliente_id: cliente.id,
            servico_id: servicoData?.id || null,
            telefone: telefone,
            nome_cliente: clienteNome,
            servico: servico,
            data_horario: dataHorario.toISOString(),
            horario_inicio: horaInicio,
            horario_fim: horaFim,
            preco: preco,
            preco_cobrado: preco,
            status: 'concluido',
            status_pagamento: statusPagamento,
            forma_pagamento: formaPagamentoFinal,
            valor_liquido: valorLiquido,
            taxa_aplicada: taxaAplicada,
            valor_pago: valorPago,
            observacoes: horarioNaoInformado
                ? `[RETROATIVO - Horário não informado] ${observacoes || ''}`
                : (observacoes ? `[RETROATIVO] ${observacoes}` : '[RETROATIVO]')
        };

        const { data: insertedAppointment, error } = await supabaseClient
            .from('agendamentos')
            .insert([appointmentData])
            .select()
            .single();

        if (error) throw error;

        // Se "Não Pago", criar registro de inadimplente automaticamente
        if (isNaoPago && insertedAppointment) {
            await createInadimplenteFromAppointment({
                agendamentoId: insertedAppointment.id,
                clienteId: cliente.id,
                telefone: telefone,
                nomeCliente: clienteNome,
                servico: servico,
                valorDevido: preco,
                dataVencimento: data,
                observacoes: `[RETROATIVO] ${observacoes || 'Registro retroativo não pago'}`
            });
        }

        showNotification('Atendimento retroativo salvo com sucesso!', 'success');
        closeRetroactiveModal();

        // Recarregar dados
        loadAppointments();
        loadTodayAppointments();
        loadOverviewData();
        loadReports();
        if (isNaoPago) {
            loadUnpaidClients(); // Atualizar lista de inadimplentes
        }

    } catch (error) {
        console.error('Erro ao salvar retroativo:', error);
        showNotification('Erro: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// =====================================================
// HELPER: Criar registro de inadimplente a partir de agendamento
// =====================================================
async function createInadimplenteFromAppointment(params) {
    if (!supabaseClient) {
        console.error('Supabase não configurado');
        return null;
    }

    try {
        const inadimplenteData = {
            agendamento_id: params.agendamentoId,
            cliente_id: params.clienteId,
            telefone: params.telefone || '',
            nome_cliente: params.nomeCliente,
            servico: params.servico,
            valor_devido: params.valorDevido,
            valor_pago: 0,
            valor_restante: params.valorDevido,
            data_vencimento: params.dataVencimento,
            status_cobranca: 'pendente',
            observacoes_cobranca: params.observacoes || 'Serviço não pago'
        };

        const { data: inadimplente, error } = await supabaseClient
            .from('inadimplentes')
            .insert([inadimplenteData])
            .select()
            .single();

        if (error) {
            console.error('Erro ao criar inadimplente:', error);
            throw error;
        }

        // Registrar log de auditoria
        await supabaseClient
            .from('logs_sistema')
            .insert([{
                tipo: 'INADIMPLENTE_CRIADO',
                origem: 'sistema',
                mensagem: `Cliente ${params.nomeCliente} marcado como inadimplente - R$ ${params.valorDevido.toFixed(2)}`,
                detalhes: {
                    agendamento_id: params.agendamentoId,
                    cliente_id: params.clienteId,
                    valor: params.valorDevido,
                    servico: params.servico,
                    data_criacao: new Date().toISOString()
                }
            }]);

        console.log('Inadimplente criado:', inadimplente);
        return inadimplente;

    } catch (error) {
        console.error('Erro ao criar registro de inadimplente:', error);
        showNotification('Erro ao registrar inadimplência: ' + error.message, 'error');
        return null;
    }
}

// Listener para atualizar resumo quando digitar preço
document.addEventListener('DOMContentLoaded', () => {
    const retroPreco = document.getElementById('retroPreco');
    if (retroPreco) {
        retroPreco.addEventListener('input', updateRetroSummary);
    }

    // Configurar autocomplete para o campo de nome no retroativo
    const retroNome = document.getElementById('retroNome');
    if (retroNome) {
        retroNome.addEventListener('input', debounce(handleRetroClientAutocomplete, 300));
    }
});

// Variável para armazenar cliente selecionado no retroativo
let selectedRetroClientId = null;

// Autocomplete para o modal retroativo
async function handleRetroClientAutocomplete() {
    const input = document.getElementById('retroNome');
    const suggestions = document.getElementById('retroClientSuggestions');
    const query = input.value.trim().toLowerCase();

    selectedRetroClientId = null;
    document.getElementById('retroClienteId').value = '';

    if (query.length < 2) {
        suggestions.style.display = 'none';
        return;
    }

    // Buscar nos clientes em cache
    const matches = allClients.filter(c =>
        c.nome.toLowerCase().includes(query) ||
        (c.telefone && c.telefone.includes(query))
    ).slice(0, 8);

    if (matches.length === 0) {
        suggestions.style.display = 'none';
        return;
    }

    let html = '';
    matches.forEach(client => {
        const telefoneFormatado = client.telefone ? formatPhoneDisplay(client.telefone) : 'Sem telefone';
        html += `
            <div class="client-suggestion" onclick="selectRetroClient(${client.id}, '${client.nome.replace(/'/g, "\\'")}', '${client.telefone || ''}')">
                <div class="client-suggestion-name">${client.nome}</div>
                <div class="client-suggestion-phone">${telefoneFormatado}</div>
            </div>
        `;
    });

    suggestions.innerHTML = html;
    suggestions.style.display = 'block';
}

// Selecionar cliente do autocomplete
function selectRetroClient(id, nome, telefone) {
    document.getElementById('retroNome').value = nome;
    document.getElementById('retroClienteId').value = id;
    selectedRetroClientId = id;

    // Preencher telefone se tiver
    if (telefone) {
        const cleanPhone = telefone.replace(/\D/g, '');
        if (cleanPhone.length >= 11) {
            document.getElementById('retroDDD').value = cleanPhone.substring(2, 4);
            document.getElementById('retroNumero').value = cleanPhone.substring(4);
        }
    }

    document.getElementById('retroClientSuggestions').style.display = 'none';
    showNotification(`Cliente "${nome}" selecionado!`, 'success');
}

// Abrir modal de busca de cliente para o retroativo
function openClientSearchForRetro() {
    // Passar contexto 'retro' para a busca
    openClientSearchModal('retro');
}

// Função de cliente rápido para retroativo
function openQuickClientForRetro() {
    const nome = document.getElementById('retroNome').value.trim();
    if (!nome) {
        showNotification('Digite o nome do cliente primeiro', 'warning');
        document.getElementById('retroNome').focus();
        return;
    }

    // O cliente será criado automaticamente ao salvar se não existir
    showNotification(`Cliente "${nome}" será cadastrado ao salvar`, 'info');
}

// Fechar sugestões ao clicar fora
document.addEventListener('click', (e) => {
    const suggestions = document.getElementById('retroClientSuggestions');
    const input = document.getElementById('retroNome');
    if (suggestions && input && !suggestions.contains(e.target) && e.target !== input) {
        suggestions.style.display = 'none';
    }
});

// =====================================================
// REALTIME SUBSCRIPTION - Atualização automática da UI
// =====================================================
function setupRealtimeSubscription() {
    if (!supabaseClient) return;

    supabaseClient
        .channel('db-changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'agendamentos' },
            (payload) => {
                console.log('Realtime: mudança detectada', payload);
                // Quando o bot ou alguém marcar, atualiza a UI instantaneamente
                loadTodayAppointments();
                loadOverviewData();
                if (currentSection === 'schedule') loadScheduleGrid();
                if (currentSection === 'appointments') loadAppointments();
                showNotification('Agenda atualizada em tempo real!', 'info');
            }
        )
        .subscribe((status) => {
            console.log('Realtime subscription status:', status);
        });
}

// =====================================================
// AGENDAMENTO SEGURO via RPC (Atomicidade no Banco)
// =====================================================
async function handleSecureBooking(params) {
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    const { data, error } = await supabaseClient.rpc('realizar_agendamento_seguro', {
        p_cliente_id: params.clienteId,
        p_servico_id: params.servicoId,
        p_telefone: params.telefone,
        p_nome_cliente: params.nome,
        p_servico_nome: params.servico,
        p_data_horario: params.dataISO,
        p_horario_inicio: params.inicio,
        p_horario_fim: params.fim,
        p_preco: params.preco
    });

    if (error) {
        console.error('Erro RPC:', error);
        throw new Error(error.message || 'Erro ao processar agendamento no banco.');
    }

    if (!data || !data.success) {
        throw new Error(data?.error || 'Horário indisponível. Por favor, escolha outro.');
    }

    return data;
}

// =====================================================
// BUSCAR OU CRIAR CLIENTE (telefone é opcional)
// =====================================================
async function findOrCreateClient(telefone, nome) {
    if (!supabaseClient) {
        throw new Error('Supabase não configurado');
    }

    // Limpar telefone (se houver)
    const telefoneLimpo = telefone ? telefone.replace(/\D/g, '') : '';

    // Se tiver telefone, tentar buscar por telefone primeiro
    if (telefoneLimpo && telefoneLimpo.length >= 10) {
        const { data: clientePorTelefone } = await supabaseClient
            .from('clientes')
            .select('*')
            .eq('telefone', telefoneLimpo)
            .limit(1)
            .single();

        if (clientePorTelefone) {
            return clientePorTelefone;
        }
    }

    // Buscar por nome similar (se não encontrou por telefone)
    const { data: clientesPorNome } = await supabaseClient
        .from('clientes')
        .select('*')
        .ilike('nome', `%${nome.trim()}%`)
        .limit(5);

    // Se encontrou exatamente pelo nome, retornar
    const clienteExato = clientesPorNome?.find(c =>
        c.nome.toLowerCase().trim() === nome.toLowerCase().trim()
    );
    if (clienteExato) {
        return clienteExato;
    }

    // Criar novo cliente
    const novoCliente = {
        nome: nome.trim(),
        telefone: telefoneLimpo || null // Telefone é opcional
    };

    const { data: clienteCriado, error } = await supabaseClient
        .from('clientes')
        .insert([novoCliente])
        .select()
        .single();

    if (error) {
        console.error('Erro ao criar cliente:', error);
        throw new Error('Erro ao cadastrar cliente: ' + error.message);
    }

    console.log('Novo cliente criado:', clienteCriado);
    return clienteCriado;
}

// =====================================================
// VALIDAÇÃO DE DADOS (Zod-like básico)
// =====================================================
function validateAppointmentData(data) {
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

// =====================================================
// FUNÇÕES DE TELEFONE SEGMENTADO
// =====================================================

// Monta o telefone completo a partir dos campos separados
function montarTelefone(prefix, dddId, numeroId) {
    const ddd = document.getElementById(dddId)?.value.replace(/\D/g, '') || '';
    const numero = document.getElementById(numeroId)?.value.replace(/\D/g, '') || '';

    if (!ddd || !numero || numero.length < 8) {
        return '';
    }

    // Formato: 55 XX 9XXXX-XXXX
    const numeroFormatado = numero.substring(0, 4) + '-' + numero.substring(4, 8);
    return `55 ${ddd} 9${numeroFormatado}`;
}

// Atualiza o campo hidden do telefone (ADD)
function atualizarTelefoneAdd() {
    const telefoneCompleto = montarTelefone('add', 'addDDD', 'addNumero');
    document.getElementById('addTelefone').value = telefoneCompleto;
}

// Atualiza o campo hidden do telefone (EDIT)
function atualizarTelefoneEdit() {
    const telefoneCompleto = montarTelefone('edit', 'editDDD', 'editNumero');
    document.getElementById('editTelefone').value = telefoneCompleto;
}

// Desmembra um telefone existente nos campos separados
function desmembrarTelefone(telefone, dddId, numeroId) {
    if (!telefone) return;

    // Remove tudo que não é número
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

// Formata o número enquanto digita (adiciona hífen automaticamente)
function formatarNumeroDigitando(input) {
    let valor = input.value.replace(/\D/g, '');

    if (valor.length > 4) {
        valor = valor.substring(0, 4) + '-' + valor.substring(4, 8);
    }

    input.value = valor;
}

// Atualiza o campo hidden do telefone (UNPAID/Inadimplentes)
function atualizarTelefoneUnpaid() {
    const telefoneCompleto = montarTelefone('unpaid', 'addUnpaidDDD', 'addUnpaidNumero');
    document.getElementById('addUnpaidTelefone').value = telefoneCompleto;
}

// Atualiza o campo hidden do telefone (Adicionar Cliente)
function atualizarTelefoneAddClient() {
    const telefoneCompleto = montarTelefone('addClient', 'addClientDDD', 'addClientNumero');
    document.getElementById('addClientTelefone').value = telefoneCompleto;
}

// Atualiza o campo hidden do telefone (Editar Cliente)
function atualizarTelefoneEditClient() {
    const telefoneCompleto = montarTelefone('editClient', 'editClientDDD', 'editClientNumero');
    document.getElementById('editClientTelefone').value = telefoneCompleto;
}

// Inicializa os eventos dos campos de telefone
function inicializarCamposTelefone() {
    // ADD - DDD
    const addDDD = document.getElementById('addDDD');
    if (addDDD) {
        addDDD.addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').substring(0, 2);
            atualizarTelefoneAdd();
            // Auto-avança para número quando DDD completo
            if (this.value.length === 2) {
                document.getElementById('addNumero')?.focus();
            }
        });
    }

    // ADD - Número
    const addNumero = document.getElementById('addNumero');
    if (addNumero) {
        addNumero.addEventListener('input', function () {
            formatarNumeroDigitando(this);
            atualizarTelefoneAdd();
        });
    }

    // EDIT - DDD
    const editDDD = document.getElementById('editDDD');
    if (editDDD) {
        editDDD.addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').substring(0, 2);
            atualizarTelefoneEdit();
            // Auto-avança para número quando DDD completo
            if (this.value.length === 2) {
                document.getElementById('editNumero')?.focus();
            }
        });
    }

    // EDIT - Número
    const editNumero = document.getElementById('editNumero');
    if (editNumero) {
        editNumero.addEventListener('input', function () {
            formatarNumeroDigitando(this);
            atualizarTelefoneEdit();
        });
    }

    // UNPAID (Inadimplentes) - DDD
    const unpaidDDD = document.getElementById('addUnpaidDDD');
    if (unpaidDDD) {
        unpaidDDD.addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').substring(0, 2);
            atualizarTelefoneUnpaid();
            if (this.value.length === 2) {
                document.getElementById('addUnpaidNumero')?.focus();
            }
        });
    }

    // UNPAID - Número
    const unpaidNumero = document.getElementById('addUnpaidNumero');
    if (unpaidNumero) {
        unpaidNumero.addEventListener('input', function () {
            formatarNumeroDigitando(this);
            atualizarTelefoneUnpaid();
        });
    }

    // ADICIONAR CLIENTE - DDD
    const addClientDDD = document.getElementById('addClientDDD');
    if (addClientDDD) {
        addClientDDD.addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').substring(0, 2);
            atualizarTelefoneAddClient();
            if (this.value.length === 2) {
                document.getElementById('addClientNumero')?.focus();
            }
        });
    }

    // ADICIONAR CLIENTE - Número
    const addClientNumero = document.getElementById('addClientNumero');
    if (addClientNumero) {
        addClientNumero.addEventListener('input', function () {
            formatarNumeroDigitando(this);
            atualizarTelefoneAddClient();
        });
    }

    // EDITAR CLIENTE - DDD
    const editClientDDD = document.getElementById('editClientDDD');
    if (editClientDDD) {
        editClientDDD.addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').substring(0, 2);
            atualizarTelefoneEditClient();
            if (this.value.length === 2) {
                document.getElementById('editClientNumero')?.focus();
            }
        });
    }

    // EDITAR CLIENTE - Número
    const editClientNumero = document.getElementById('editClientNumero');
    if (editClientNumero) {
        editClientNumero.addEventListener('input', function () {
            formatarNumeroDigitando(this);
            atualizarTelefoneEditClient();
        });
    }
}

// =====================================================
// Função para formatar telefone (55 XX 9XXXX-XXXX)
// =====================================================
function formatarTelefone(telefone) {
    if (!telefone) return '';

    // Remove tudo que não é número
    const apenasNumeros = telefone.replace(/\D/g, '');

    // Se tiver menos de 11 dígitos (sem o 55), adiciona 55
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

    return telefone; // Retorna como está se não se encaixar nos casos acima
}

// Verificar se as configurações do Supabase estão disponíveis
if (typeof SUPABASE_CONFIG !== 'undefined' &&
    SUPABASE_CONFIG.url &&
    SUPABASE_CONFIG.anonKey &&
    SUPABASE_CONFIG.url !== 'https://your-project-ref.supabase.co' &&
    SUPABASE_CONFIG.anonKey !== 'your-anon-key-here') {

    try {
        // Verificar se a biblioteca Supabase foi carregada
        if (typeof supabase !== 'undefined' && supabase.createClient) {
            const { createClient } = supabase;
            supabaseClient = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
            isSupabaseConfigured = true;
        } else {
            throw new Error('Biblioteca Supabase não carregada');
        }
    } catch (error) {
        console.error('Erro ao configurar Supabase:', error);
        showNotification('❌ Erro: Supabase não configurado corretamente. Verifique o arquivo config.js', 'error');
        isSupabaseConfigured = false;
        supabaseClient = null;
    }
} else {
    showNotification('❌ Erro: Supabase não configurado. Configure o arquivo config.js para usar o sistema.', 'error');
    console.error('Supabase não configurado. Configure o arquivo config.js');
    isSupabaseConfigured = false;
}

// Estado da aplicação
let currentUser = null;
let currentSection = 'overview';
let clients = [];
let services = [];
let appointments = [];
let todayAppointments = [];
let selectedAddClientId = null; // Cliente selecionado no autocomplete do ADD

// Cache para dados do banco
const dataCache = new Map();
const clientsCache = new Map();
const servicesCache = new Map();

// Função para carregar serviços do banco
async function loadServices() {
    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar serviços');
        return [];
    }

    try {
        const { data, error } = await supabaseClient
            .from('servicos')
            .select('*')
            .eq('ativo', true)
            .order('categoria', { ascending: true });

        if (error) throw error;

        services = data || [];

        // Atualizar cache
        services.forEach(service => {
            servicesCache.set(service.id, service);
        });

        // Atualizar os selects de serviço com dados do banco
        popularSelectsServicos();

        return services;
    } catch (error) {
        console.error('Erro ao carregar serviços:', error);
        return [];
    }
}

// Função para popular os selects de serviço com dados do banco
function popularSelectsServicos() {
    const selects = [
        'addServico',
        'editServico',
        'addUnpaidServico'
    ];

    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;

        // Preservar valor selecionado
        const valorAtual = select.value;

        // Limpar opções exceto a primeira (placeholder)
        select.innerHTML = '<option value="">Selecione um serviço</option>';

        // Adicionar serviços do banco
        services.forEach(servico => {
            const option = document.createElement('option');
            option.value = servico.nome;
            option.textContent = servico.nome;
            option.dataset.preco = servico.preco_base;
            option.dataset.duracao = servico.duracao_minutos;
            select.appendChild(option);
        });

        // Restaurar valor se existia
        if (valorAtual) {
            select.value = valorAtual;
        }
    });
}

// Função para buscar ou criar cliente
async function findOrCreateClient(telefone, nome) {
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
                .is('telefone', null)  // Cliente sem telefone
                .single();

            if (!searchError && existingClient) {
                clientsCache.set(existingClient.id, existingClient);
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

            clientsCache.set(newClient.id, newClient);
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
            // Cliente encontrado, atualizar cache
            clientsCache.set(existingClient.id, existingClient);
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

        // Adicionar ao cache
        clientsCache.set(newClient.id, newClient);

        return newClient;
    } catch (error) {
        console.error('Erro ao buscar/criar cliente:', error);
        throw error;
    }
}

// Função utilitária para calcular horário de fim
function calculateEndTime(startTime, durationMinutes = 30) {
    const [hours, minutes] = startTime.split(':').map(Number);
    const endTime = new Date();
    endTime.setHours(hours, minutes + durationMinutes, 0, 0);
    const endHours = endTime.getHours().toString().padStart(2, '0');
    const endMinutes = endTime.getMinutes().toString().padStart(2, '0');
    return `${endHours}:${endMinutes}`;
}

// Função legada removida - usar checkTimeConflictSupabase

// Função utilitária para debounce (melhora performance em buscas)
function debounce(func, wait) {
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

// Função para cache simples de dados
// Remove duplicate dataCache declaration since it's already declared at the top
function getCachedData(key, fetchFunction, ttl = 300000) { // 5 minutos de cache
    const cached = dataCache.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
        return Promise.resolve(cached.data);
    }

    return fetchFunction().then(data => {
        dataCache.set(key, { data, timestamp: Date.now() });
        return data;
    });
}

// Função para limpar cache
function clearCache(key = null) {
    if (key) {
        dataCache.delete(key);
    } else {
        dataCache.clear();
    }
}

// =====================================================
// @DEPRECATED - Verificação manual de conflitos
// A atomicidade agora é garantida pela RPC `realizar_agendamento_seguro`
// Esta função é mantida apenas para compatibilidade com saveAppointment (edição)
// =====================================================
async function checkTimeConflictSupabase(date, startTime, endTime, excludeId = null) {
    if (!supabaseClient) return { conflict: false };

    try {
        let query = supabaseClient
            .from('vw_agendamentos_completos')
            .select('id, cliente_nome, horario_inicio, horario_fim, status')
            .gte('data_horario', `${date}T00:00:00`)
            .lte('data_horario', `${date}T23:59:59`)
            .neq('status', 'cancelado'); // Ignorar agendamentos cancelados

        if (excludeId) {
            query = query.neq('id', excludeId);
        }

        const { data: existingAppointments, error } = await query;

        if (error) throw error;

        // Função auxiliar para converter horário em minutos para comparação precisa
        const timeToMinutes = (time) => {
            if (!time) return 0;
            const parts = time.split(':');
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        };

        const newStart = timeToMinutes(startTime);
        const newEnd = timeToMinutes(endTime);

        for (const apt of existingAppointments || []) {
            const aptStart = timeToMinutes(apt.horario_inicio);
            const aptEnd = timeToMinutes(apt.horario_fim);

            // Verificar sobreposição de horários
            // Conflito: novo começa antes do existente terminar E novo termina depois do existente começar
            // Permitido: novo começa exatamente quando existente termina (newStart == aptEnd)
            // Permitido: novo termina exatamente quando existente começa (newEnd == aptStart)
            if (newStart < aptEnd && newEnd > aptStart) {
                return {
                    conflict: true,
                    conflictWith: {
                        ...apt,
                        nome_cliente: apt.cliente_nome
                    }
                };
            }
        }

        return { conflict: false };
    } catch (error) {
        console.error('Erro ao verificar conflitos:', error);
        return { conflict: false };
    }
}

// Função para normalizar telefone - remove todos os caracteres não numéricos
function normalizePhone(phone) {
    if (!phone) return '';

    // Remove todos os caracteres não numéricos
    let normalized = phone.replace(/\D/g, '');

    // Se tem 13 dígitos e começa com 55, está no formato correto (55 + DDD + 9 + número)
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

    // Debug removido para performance
    return normalized;
}

// Função para formatar telefone para exibição (DDD) 9XXXX-XXXX
function formatPhoneDisplay(phone) {
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

// Função para comparar telefones (verifica se são o mesmo número)
function phonesMatch(phone1, phone2) {
    const normalized1 = normalizePhone(phone1);
    const normalized2 = normalizePhone(phone2);
    return normalized1 === normalized2;
}

// Função utilitária para formatar horário sem segundos
function formatTimeHHMM(timeString) {
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

// Função para obter horário formatado de um agendamento
function getFormattedTime(appointment) {
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

// Função para calcular todos os slots de 15 minutos ocupados durante um período
function getOccupiedTimeSlots(startTime, endTime) {
    const slots = [];

    if (!startTime) {
        return slots;
    }

    // Se não tem horário de fim, assumir 30 minutos
    if (!endTime) {
        const [hours, minutes] = startTime.split(':').map(Number);
        const startDate = new Date();
        startDate.setHours(hours, minutes, 0, 0);
        const endDate = new Date(startDate.getTime() + 30 * 60000); // +30 minutos
        endTime = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;
    }

    // Converter horários para minutos para facilitar o cálculo
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

// Função para gerar slots de 15 minutos entre dois horários (inclusive o horário final)
function generate15MinSlots(horaInicio, horaFim) {
    const toMins = h => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm; };
    const fromMins = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const start = toMins(horaInicio), end = toMins(horaFim);
    const slots = [];
    // Usa <= para incluir o horário final (ex: 12:00)
    for (let t = start; t <= end; t += 15) slots.push(fromMins(t));
    return slots;
}

// =====================================================
// AUTENTICAÇÃO via Supabase Auth (SEGURA)
// =====================================================
// REMOVIDO: Credenciais hardcoded (FALHA DE SEGURANÇA)
// Agora usa supabase.auth.signInWithPassword()

// Elementos DOM
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const errorMessage = document.getElementById('loginError');
const userNameSpan = document.getElementById('userName');

// Inicialização
document.addEventListener('DOMContentLoaded', function () {
    initializeApp();
    setupEventListeners();
    loadAllClients();
    setupAllClientAutocomplete();
    inicializarCamposTelefone(); // Inicializar campos de telefone segmentados

    // Configurar Realtime para atualizações automáticas
    if (isSupabaseConfigured) {
        setupRealtimeSubscription();
    }

    // Definir data de hoje por padrão
    const today = new Date().toISOString().split('T')[0];
    const scheduleDateInput = document.getElementById('scheduleDate');
    if (scheduleDateInput) {
        scheduleDateInput.value = today;
    }

    const currentDateInput = document.getElementById('currentDate');
    if (currentDateInput) {
        currentDateInput.value = today;
    }

    // Configurar filtros de turno após um pequeno delay
    setTimeout(() => {
        setupScheduleFilters();
    }, 500);
});

async function initializeApp() {
    // Verificar sessão do Supabase Auth primeiro
    if (supabaseClient) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session?.user) {
                currentUser = {
                    id: session.user.id,
                    email: session.user.email,
                    username: session.user.user_metadata?.nome || 'Usuário',
                    role: session.user.user_metadata?.role || 'barbeiro'
                };
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                showDashboard();
                setDefaultDates();
                loadDashboardData();

                if (isSupabaseConfigured) {
                    initializeAppointmentStatusChecker();
                }
                return;
            }
        } catch (err) {
            console.warn('Erro ao verificar sessão:', err);
        }
    }

    // Fallback: verificar localStorage (compatibilidade)
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showDashboard();
        setDefaultDates();
        loadDashboardData();

        if (isSupabaseConfigured) {
            initializeAppointmentStatusChecker();
        }
    } else {
        showLogin();
    }
}

function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];

    // Definir data atual para overview
    const currentDateInput = document.getElementById('currentDate');
    if (currentDateInput && !currentDateInput.value) {
        currentDateInput.value = today;
    }

    // Definir data atual para agenda
    const scheduleDateInput = document.getElementById('scheduleDate');
    if (scheduleDateInput && !scheduleDateInput.value) {
        scheduleDateInput.value = today;
    }
}

function setupEventListeners() {
    // Login form
    loginForm.addEventListener('submit', handleLogin);

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Navegação
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', handleNavigation);
    });

    // Botões de ação
    document.getElementById('currentDate').addEventListener('change', loadOverviewData);
    document.getElementById('todayBtn').addEventListener('click', () => setDateToToday('currentDate'));
    document.getElementById('scheduleTodayBtn').addEventListener('click', () => setDateToToday('scheduleDate'));
    document.getElementById('tomorrowBtn').addEventListener('click', () => setDateToTomorrow('scheduleDate'));
    document.getElementById('refreshAppointments').addEventListener('click', () => loadAppointments());

    // Modal
    document.querySelector('.close').addEventListener('click', closeModal);
    document.querySelector('.btn-cancel').addEventListener('click', closeModal);
    // Remover listener genérico que conflita com o modal de adicionar

    // Listener dedicado ao formulário de adicionar (evita conflito)
    const addForm = document.getElementById('addForm');
    if (addForm) {
        addForm.addEventListener('submit', (e) => {
            // Impedir múltiplos envios
            if (addForm.dataset.submitting === 'true') {
                e.preventDefault();
                return;
            }
            addForm.dataset.submitting = 'true';
            addNewAppointment(e).finally(() => {
                delete addForm.dataset.submitting;
            });
        });
    }

    // Filtros
    document.getElementById('dateFilter').addEventListener('change', loadAppointments);
    document.getElementById('statusFilter').addEventListener('change', loadAppointments);
    document.getElementById('clientSearch').addEventListener('input', filterClients);
    document.getElementById('scheduleDate').addEventListener('change', loadScheduleGrid);
    document.getElementById('reportStartDate').addEventListener('change', updateReportData);
    document.getElementById('reportEndDate').addEventListener('change', updateReportData);
}

// Autenticação via Supabase Auth (SEGURA)
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (!supabaseClient) {
        showError('Sistema não configurado. Verifique config.js');
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            console.error('Erro de autenticação:', error);
            showError('Email ou senha incorretos!');
            return;
        }

        if (data.user) {
            currentUser = {
                id: data.user.id,
                email: data.user.email,
                username: data.user.user_metadata?.nome || 'Jão',
                role: data.user.user_metadata?.role || 'barbeiro'
            };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            showDashboard();
            await loadDashboardData();
        }
    } catch (err) {
        console.error('Erro no login:', err);
        showError('Erro ao fazer login. Tente novamente.');
    }
}

async function handleLogout() {
    if (supabaseClient) {
        await supabaseClient.auth.signOut();
    }
    currentUser = null;
    localStorage.removeItem('currentUser');
    showLogin();
}

function showLogin() {
    loginScreen.style.display = 'flex';
    dashboard.style.display = 'none';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    hideError();
}

function showDashboard() {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'grid';
    userNameSpan.textContent = currentUser.username || currentUser.email;
    showSection('overview');
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

function hideError() {
    errorMessage.style.display = 'none';
}

// Navegação
function handleNavigation(e) {
    e.preventDefault();
    const sectionId = e.currentTarget.getAttribute('data-section');
    showSection(sectionId);
}

function showSection(sectionId) {
    // Atualizar navegação ativa
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-section="${sectionId}"]`).classList.add('active');

    // Mostrar seção
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(sectionId).classList.add('active');

    currentSection = sectionId;

    // Carregar dados específicos da seção
    switch (sectionId) {
        case 'overview':
            loadOverviewData();
            break;
        case 'appointments':
            loadAppointments();
            break;
        case 'schedule':
            loadScheduleGrid();
            break;
        case 'clients':
            loadClients();
            setupClientSearch();
            break;
        case 'reports':
            // Carregar relatórios automaticamente
            setTimeout(() => loadReports(), 100);
            break;
        case 'unpaid':
            loadUnpaidClients();
            break;
    }
}

// Carregamento de dados
async function loadDashboardData() {
    showLoading();
    try {
        // Carregar serviços primeiro
        await loadServices();

        // Carregar dados sequencialmente para garantir que appointments seja carregado primeiro
        await loadAppointments();

        // Aguardar um pouco para garantir que appointments foi populado
        await new Promise(resolve => setTimeout(resolve, 100));

        await loadTodayAppointments();
        await loadOverviewData();

        // Carregar grade de horários se estivermos na seção agenda
        if (currentSection === 'schedule') {
            await loadScheduleGrid();
        }

    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        showError('Erro ao carregar dados do dashboard');
    } finally {
        hideLoading();
    }
}

async function loadAppointments() {
    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar agendamentos');
        showError('Erro: Supabase não configurado. Configure o arquivo config.js');
        return;
    }

    try {
        const dateFilter = document.getElementById('dateFilter').value;
        const statusFilter = document.getElementById('statusFilter').value;

        // Usar a view que já faz os JOINs
        let query = supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .order('data_horario', { ascending: true });

        if (dateFilter) {
            // Filtrar por data usando a coluna data_horario
            const startDate = `${dateFilter}T00:00:00`;
            const endDate = `${dateFilter}T23:59:59`;
            query = query.gte('data_horario', startDate).lte('data_horario', endDate);
        }

        if (statusFilter && statusFilter !== 'todos') {
            query = query.eq('status', statusFilter);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Mapear dados da view para formato compatível
        appointments = (data || []).map(apt => {
            // A view retorna: cliente_nome_completo (COALESCE de c.nome e a.nome_cliente)
            // e telefone (direto da tabela agendamentos)
            const nomeCliente = apt.cliente_nome_completo || apt.nome_cliente || apt.cliente_nome;
            const telefoneCliente = apt.telefone || apt.cliente_telefone;

            const mapped = {
                id: apt.id,
                data_horario: apt.data_horario,
                horario_inicio: apt.horario_inicio,
                horario_fim: apt.horario_fim,
                status: apt.status,
                preco_cobrado: parseFloat(apt.preco) || parseFloat(apt.preco_cobrado) || 0,
                observacoes: apt.observacoes,
                cliente_nome: (nomeCliente && String(nomeCliente).trim() && !['undefined', 'null'].includes(String(nomeCliente).trim().toLowerCase())) ? nomeCliente : 'Cliente não identificado',
                telefone: (telefoneCliente && String(telefoneCliente).trim() && !['undefined', 'null'].includes(String(telefoneCliente).trim().toLowerCase())) ? telefoneCliente : '',
                servico: apt.servico_nome || apt.servico,
                duracao_minutos: apt.duracao_minutos,
                valor_pago: apt.valor_pago || 0,
                valor_pendente: apt.valor_pendente || 0,
                valor_pago: apt.valor_pago || 0,
                valor_pendente: apt.valor_pendente || 0,
                pagamento: apt.status_pagamento,
                forma_pagamento: apt.forma_pagamento || 'dinheiro'
            };
            return mapped;
        });

        renderAppointmentsTable();

    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
        showError('Erro ao carregar agendamentos');
    }
}



async function loadTodayAppointments() {
    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar agendamentos de hoje');
        return;
    }

    try {
        const selectedDate = document.getElementById('currentDate').value || new Date().toISOString().split('T')[0];
        const startDate = `${selectedDate}T00:00:00`;
        const endDate = `${selectedDate}T23:59:59`;

        const { data, error } = await supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .gte('data_horario', startDate)
            .lte('data_horario', endDate)
            .order('horario_inicio', { ascending: true });

        if (error) throw error;

        // Mapear dados da view para formato compatível
        todayAppointments = (data || []).map((apt) => {
            // A view retorna: cliente_nome_completo (COALESCE de c.nome e a.nome_cliente)
            // e telefone (direto da tabela agendamentos)
            const nomeCliente = apt.cliente_nome_completo || apt.nome_cliente || apt.cliente_nome;
            const telefoneCliente = apt.telefone || apt.cliente_telefone;

            const mapped = {
                id: apt.id,
                data_horario: apt.data_horario,
                horario_inicio: apt.horario_inicio,
                horario_fim: apt.horario_fim,
                status: apt.status,
                preco_cobrado: parseFloat(apt.preco) || parseFloat(apt.preco_cobrado) || 0,
                observacoes: apt.observacoes,
                cliente_nome: (nomeCliente && String(nomeCliente).trim() && !['undefined', 'null'].includes(String(nomeCliente).trim().toLowerCase())) ? nomeCliente : 'Cliente não identificado',
                telefone: (telefoneCliente && String(telefoneCliente).trim() && !['undefined', 'null'].includes(String(telefoneCliente).trim().toLowerCase())) ? telefoneCliente : '',
                servico: apt.servico_nome || apt.servico,
                duracao_minutos: apt.duracao_minutos,
                valor_pago: apt.valor_pago || 0,
                valor_pendente: apt.valor_pendente || 0,
                valor_pago: apt.valor_pago || 0,
                valor_pendente: apt.valor_pendente || 0,
                pagamento: apt.status_pagamento,
                forma_pagamento: apt.forma_pagamento || 'dinheiro'
            };
            return mapped;
        });

        renderTodaySchedule();

    } catch (error) {
        console.error('Erro ao carregar agendamentos de hoje:', error);
    }
}

async function loadOverviewData() {
    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar dados de overview');
        return;
    }

    try {
        // Usar a data selecionada ou hoje como padrão
        const selectedDate = document.getElementById('currentDate').value || new Date().toISOString().split('T')[0];
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

        // Agendamentos da data selecionada
        const { data: selectedDateData } = await supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .gte('data_horario', `${selectedDate}T00:00:00`)
            .lte('data_horario', `${selectedDate}T23:59:59`);

        // Agendamentos do mês
        const { data: monthData } = await supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .gte('data_horario', `${startOfMonth}T00:00:00`);

        // Clientes únicos do mês
        const uniqueClients = new Set(monthData?.map(item => item.cliente_nome) || []);

        // Receita do mês (APENAS agendamentos com status_pagamento === 'pago')
        // Qualquer agendamento que não esteja explicitamente marcado como PAGO não entra no faturamento
        const monthlyRevenue = monthData?.filter(apt =>
            apt.status === 'concluido' && apt.status_pagamento === 'pago'
        ).reduce((total, apt) => total + (parseFloat(apt.preco_cobrado) || 0), 0) || 0;

        // Próximo cliente da data selecionada
        const nextAppointment = selectedDateData?.find(apt => {
            const now = new Date();
            const aptTime = new Date(apt.data_horario);
            return aptTime > now && (apt.status === 'agendado' || apt.status === 'confirmado');
        });
        const nextClient = nextAppointment ? (nextAppointment.cliente_nome || nextAppointment.nome_cliente) : 'Nenhum';

        // Receita da data selecionada (bruto) - APENAS status_pagamento === 'pago'
        const selectedDateRevenue = selectedDateData?.filter(apt =>
            apt.status === 'concluido' && apt.status_pagamento === 'pago'
        ).reduce((total, apt) => total + (parseFloat(apt.preco_cobrado) || parseFloat(apt.preco) || 0), 0) || 0;

        // Receita Líquida (usando valor_liquido do banco ou calculando se não existir)
        // APENAS status_pagamento === 'pago'
        const selectedDateNetRevenue = selectedDateData?.filter(apt =>
            apt.status === 'concluido' && apt.status_pagamento === 'pago'
        ).reduce((total, apt) => {
            // Se já tem valor_liquido gravado no banco, usa ele
            if (apt.valor_liquido != null && apt.valor_liquido !== 0) {
                return total + parseFloat(apt.valor_liquido);
            }
            // Senão, calcula baseado na forma_pagamento (ou assume 0 de taxa se não tiver)
            const preco = parseFloat(apt.preco_cobrado) || parseFloat(apt.preco) || 0;
            const formaPag = apt.forma_pagamento || 'dinheiro';
            return total + calculateNetValue(preco, formaPag);
        }, 0) || 0;

        // Taxa de ocupação (estimativa)
        const totalSlots = 20; // 10 horas * 2 slots por hora
        const occupiedSlots = selectedDateData?.length || 0;
        const occupancyRate = Math.round((occupiedSlots / totalSlots) * 100);

        // Atualizar elementos de estatísticas
        document.getElementById('todayAppointments').textContent = selectedDateData?.length || 0;
        document.getElementById('nextClient').textContent = nextClient;
        document.getElementById('todayRevenue').textContent = `R$ ${selectedDateRevenue.toFixed(2)}`;
        document.getElementById('occupancyRate').textContent = `${occupancyRate}%`;

        // Atualizar Receita Líquida (novo card)
        const netRevenueEl = document.getElementById('todayNetRevenue');
        if (netRevenueEl) {
            netRevenueEl.textContent = `R$ ${selectedDateNetRevenue.toFixed(2)}`;
        }

        // Atualizar agendamentos da data selecionada (independente de ser hoje)
        todayAppointments = (selectedDateData || []).map((apt) => {
            const nomeCliente = apt.cliente_nome_completo || apt.nome_cliente || apt.cliente_nome;
            const telefoneCliente = apt.telefone || apt.cliente_telefone;
            return {
                id: apt.id,
                data_horario: apt.data_horario,
                horario_inicio: apt.horario_inicio,
                horario_fim: apt.horario_fim,
                status: apt.status,
                preco_cobrado: parseFloat(apt.preco) || parseFloat(apt.preco_cobrado) || 0,
                observacoes: apt.observacoes,
                cliente_nome: (nomeCliente && String(nomeCliente).trim() && !['undefined', 'null'].includes(String(nomeCliente).trim().toLowerCase())) ? nomeCliente : 'Cliente não identificado',
                telefone: (telefoneCliente && String(telefoneCliente).trim() && !['undefined', 'null'].includes(String(telefoneCliente).trim().toLowerCase())) ? telefoneCliente : '',
                servico: apt.servico_nome || apt.servico,
                duracao_minutos: apt.duracao_minutos
            };
        });
        renderTodaySchedule();

    } catch (error) {
        console.error('Erro ao carregar dados de overview:', error);
    }
}



async function loadScheduleGrid() {
    const selectedDate = document.getElementById('scheduleDate')?.value || new Date().toISOString().split('T')[0];

    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar grade de horários');
        return;
    }

    try {
        const startDate = `${selectedDate}T00:00:00`;
        const endDate = `${selectedDate}T23:59:59`;

        const { data, error } = await supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .gte('data_horario', startDate)
            .lte('data_horario', endDate);

        if (error) throw error;

        renderScheduleGrid(data || [], selectedDate);

    } catch (error) {
        console.error('Erro ao carregar grade de horários:', error);
        showNotification('Erro ao carregar horários', 'error');
    }
}

async function loadReports() {
    // Carregando relatórios...

    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar relatórios');
        return;
    }

    try {
        const startDate = document.getElementById('reportStartDate').value;
        const endDate = document.getElementById('reportEndDate').value;

        let query = supabaseClient
            .from('vw_agendamentos_completos')
            .select('*')
            .order('data_horario', { ascending: false });

        if (startDate) {
            query = query.gte('data_horario', `${startDate}T00:00:00`);
        }

        if (endDate) {
            query = query.lte('data_horario', `${endDate}T23:59:59`);
        }

        // Se não há filtros, limitar aos últimos 30 dias
        if (!startDate && !endDate) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            query = query.gte('data_horario', thirtyDaysAgo.toISOString());
        }

        const { data, error } = await query;

        if (error) throw error;

        // Se não há dados, mostrar mensagem informativa
        if (!data || data.length === 0) {
            showNotification('Nenhum agendamento encontrado para o período selecionado', 'info');
        }

        // Dados carregados com sucesso
        renderReports(data || []);

    } catch (error) {
        console.error('Erro ao carregar relatórios:', error);
        showNotification('Erro ao carregar relatórios: ' + error.message, 'error');
    }
}

// Helper para filtros de relatório
function filterReports(period) {
    const today = new Date();
    let startDate = new Date();
    let endDate = new Date();

    if (period === 'today') {
        // Datas iguais
    } else if (period === 'week') {
        startDate.setDate(today.getDate() - 6);
    } else if (period === 'month') {
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }

    // Formatar YYYY-MM-DD
    const formatDate = (date) => date.toISOString().split('T')[0];

    document.getElementById('reportStartDate').value = formatDate(startDate);
    document.getElementById('reportEndDate').value = formatDate(endDate);

    loadReports();
}

// Renderização
function renderAppointmentsTable() {
    const tbody = document.getElementById('appointmentsTableBody');
    if (!tbody) {
        console.error('Elemento appointmentsTableBody não encontrado');
        return;
    }

    tbody.innerHTML = '';

    if (appointments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: rgba(255,255,255,0.5);">Nenhum agendamento encontrado</td></tr>';
        return;
    }

    appointments.forEach(appointment => {
        // Garantir que todos os valores necessários existam (evitar string "undefined"/"null")
        const rawNome = appointment?.cliente_nome ?? appointment?.nome_cliente ?? appointment?.nome ?? '';
        const clienteNome = (typeof rawNome === 'string' && rawNome.trim() && !['undefined', 'null'].includes(rawNome.trim().toLowerCase())) ? rawNome : 'Cliente não identificado';

        const rawTelefone = appointment?.telefone ?? appointment?.cliente_telefone ?? '';
        const telefone = (typeof rawTelefone === 'string' && rawTelefone.trim() && !['undefined', 'null'].includes(rawTelefone.trim().toLowerCase())) ? formatPhoneDisplay(rawTelefone) : 'Telefone não informado';

        const rawServico = appointment?.servico ?? appointment?.nome_servico ?? appointment?.servico_nome ?? '';
        const servicoNome = (typeof rawServico === 'string' && rawServico.trim() && !['undefined', 'null'].includes(rawServico.trim().toLowerCase())) ? rawServico : 'Serviço';
        const status = appointment.status || 'agendado';
        const appointmentId = appointment.id || appointment.agendamento_id || 0;
        const precoCobrando = parseFloat(appointment.preco_cobrado ?? appointment.preco ?? 0) || 0;

        const row = document.createElement('tr');
        const appointmentDate = new Date(appointment.data_horario);
        const dateStr = appointmentDate.toLocaleDateString('pt-BR');

        // Formatar horário com início e fim
        let timeStr = getFormattedTime(appointment);
        if (appointment.horario_fim) {
            const endTime = formatTimeHHMM(appointment.horario_fim);
            timeStr += ` - ${endTime}`;
        }

        // Se timeStr estiver vazio, usar um valor padrão
        if (!timeStr) {
            timeStr = '00:00';
        }

        // Determinar status do pagamento para agendamentos concluídos
        let paymentBadge = '';
        const statusPagamento = appointment.pagamento || appointment.status_pagamento;

        if (status === 'concluido') {
            // Verificar se é "Não Pago" (inadimplente)
            if (statusPagamento === 'nao_pago') {
                paymentBadge = `<span class="payment-badge payment-unpaid" title="Cliente inadimplente - Não pagou">
                    <i class="fas fa-times-circle"></i> Não Pago
                </span>`;
            } else if (!appointment.forma_pagamento || appointment.forma_pagamento === '' || (appointment.forma_pagamento === 'dinheiro' && !appointment.valor_pago)) {
                // Concluído mas sem pagamento registrado - ALERTA! (clicável)
                paymentBadge = `<span class="payment-badge payment-pending" title="Clique para definir pagamento" onclick="openQuickCompleteModal(${appointmentId})" style="cursor:pointer;">
                    <i class="fas fa-exclamation-triangle"></i> Pendente
                </span>`;
            } else {
                // Pagamento registrado
                const metodosNomes = {
                    'dinheiro': 'Dinheiro',
                    'pix': 'Pix',
                    'debito': 'Débito',
                    'credito_vista': 'Crédito',
                    'credito_parcelado': 'Créd. Parc.'
                };
                paymentBadge = `<span class="payment-badge payment-paid" title="Pago via ${metodosNomes[appointment.forma_pagamento] || appointment.forma_pagamento}">
                    <i class="fas fa-check-circle"></i> ${metodosNomes[appointment.forma_pagamento] || 'Pago'}
                </span>`;
            }
        } else if (status === 'confirmado' || status === 'agendado') {
            // Agendamento ainda não concluído - botão para concluir
            paymentBadge = `<button class="btn-quick-complete" onclick="openQuickCompleteModal(${appointmentId})" title="Concluir e registrar pagamento">
                <i class="fas fa-check"></i> Concluir
            </button>`;
        }

        row.innerHTML = `
            <td>${clienteNome}</td>
            <td>${telefone}</td>
            <td>${servicoNome}</td>
            <td>${dateStr}</td>
            <td>${timeStr}</td>
            <td>R$ ${precoCobrando.toFixed(2)}</td>
            <td>
                <span class="status-badge status-${status}">${status}</span>
                ${paymentBadge}
            </td>
            <td>
                <button class="action-btn btn-edit" onclick="editAppointment(${appointmentId})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="action-btn btn-delete" onclick="deleteAppointment(${appointmentId})">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="action-btn btn-contact" onclick="contactClientDirect('${rawTelefone}', '${clienteNome}')" title="WhatsApp">
                    <i class="fab fa-whatsapp"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function renderTodaySchedule() {
    const container = document.getElementById('todayScheduleList');
    if (!container) {
        console.error('Container todayScheduleList não encontrado');
        return;
    }

    container.innerHTML = '';

    if (todayAppointments.length === 0) {
        container.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Nenhum agendamento para hoje</p>';
        return;
    }

    // Ordenar agendamentos por horário
    const sortedAppointments = [...todayAppointments].sort((a, b) => {
        const timeA = getFormattedTime(a);
        const timeB = getFormattedTime(b);
        return timeA.localeCompare(timeB);
    });

    // Renderizar cada agendamento
    let htmlContent = '';
    sortedAppointments.forEach((appointment) => {
        // Garantir que todos os valores necessários existam (evitar string "undefined"/"null")
        const rawNome = appointment?.cliente_nome ?? appointment?.nome_cliente ?? appointment?.nome ?? '';
        const clienteNome = (typeof rawNome === 'string' && rawNome.trim() && !['undefined', 'null'].includes(rawNome.trim().toLowerCase())) ? rawNome : 'Cliente não identificado';
        const rawServico = appointment?.servico ?? appointment?.nome_servico ?? appointment?.servico_nome ?? '';
        const servicoNome = (typeof rawServico === 'string' && rawServico.trim() && !['undefined', 'null'].includes(rawServico.trim().toLowerCase())) ? rawServico : 'Serviço';
        const rawTelefone = appointment?.telefone ?? appointment?.cliente_telefone ?? '';
        const telefone = (typeof rawTelefone === 'string' && rawTelefone.trim() && !['undefined', 'null'].includes(rawTelefone.trim().toLowerCase())) ? formatPhoneDisplay(rawTelefone) : '';
        const status = appointment.status || 'agendado';
        const appointmentId = appointment.id || appointment.agendamento_id || 0;

        // Formatar horário com início e fim
        let timeStr = getFormattedTime(appointment);
        if (appointment.horario_fim) {
            const endTime = formatTimeHHMM(appointment.horario_fim);
            timeStr += ` - ${endTime}`;
        }

        // Se timeStr estiver vazio, usar um valor padrão
        if (!timeStr) {
            timeStr = '00:00';
        }

        // Determinar status do pagamento para agendamentos concluídos
        let paymentBadge = '';
        const statusPagamento = appointment.pagamento || appointment.status_pagamento;

        if (status === 'concluido') {
            // Verificar se é "Não Pago" (inadimplente)
            if (statusPagamento === 'nao_pago') {
                paymentBadge = `<span class="payment-badge payment-unpaid" title="Cliente inadimplente - Não pagou">
                    <i class="fas fa-times-circle"></i>
                </span>`;
            } else if (!appointment.forma_pagamento || appointment.forma_pagamento === '' || (appointment.forma_pagamento === 'dinheiro' && !appointment.valor_pago)) {
                paymentBadge = `<span class="payment-badge payment-pending" title="Clique para definir pagamento" onclick="openQuickCompleteModal(${appointmentId})" style="cursor:pointer;">
                    <i class="fas fa-exclamation-triangle"></i>
                </span>`;
            } else {
                paymentBadge = `<span class="payment-badge payment-paid" title="Pago via ${appointment.forma_pagamento}">
                    <i class="fas fa-check-circle"></i>
                </span>`;
            }
        } else if (status === 'confirmado' || status === 'agendado') {
            // Botão de concluir rápido
            paymentBadge = `<button class="btn-quick-complete" onclick="openQuickCompleteModal(${appointmentId})" title="Concluir">
                <i class="fas fa-check"></i>
            </button>`;
        }

        htmlContent += `
            <div class="schedule-item" data-period="${getTimePeriod(appointment)}">
                <div class="schedule-item-info">
                    <div class="schedule-time">${timeStr}</div>
                    <div class="schedule-client">${clienteNome}</div>
                    <div class="schedule-service">${servicoNome}</div>
                </div>
                <div class="schedule-actions">
                    <span class="status-badge status-${status}">${status}</span>
                    ${paymentBadge}
                    <button class="action-btn btn-edit" onclick="window.editAppointment(${appointmentId})" title="Editar" data-id="${appointmentId}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn btn-delete" onclick="window.deleteAppointment(${appointmentId})" title="Excluir" data-id="${appointmentId}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = htmlContent;

    // Adicionar event listeners programaticamente como backup
    setTimeout(() => {
        setupScheduleFilters();
        setupTodayScheduleEventListeners();
    }, 100);
}

// Função para configurar event listeners dos botões na visão geral
function setupTodayScheduleEventListeners() {
    const editButtons = document.querySelectorAll('#todayScheduleList .btn-edit');
    const deleteButtons = document.querySelectorAll('#todayScheduleList .btn-delete');

    // Configurando event listeners

    editButtons.forEach(button => {
        const appointmentId = button.getAttribute('data-id');
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Botão editar clicado
            editAppointment(appointmentId);
        });
    });

    deleteButtons.forEach(button => {
        const appointmentId = button.getAttribute('data-id');
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Botão deletar clicado
            deleteAppointment(appointmentId);
        });
    });
}

function getTimePeriod(appointment) {
    const timeStr = getFormattedTime(appointment);
    const hour = parseInt(timeStr.split(':')[0]);

    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    return 'evening';
}

function setupScheduleFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    // Configurando filtros de turno

    if (filterButtons.length === 0) {
        console.warn('Nenhum botão de filtro encontrado');
        return;
    }

    filterButtons.forEach(button => {
        button.addEventListener('click', function () {
            // Filtro aplicado

            // Remover classe active de todos os botões
            filterButtons.forEach(btn => btn.classList.remove('active'));
            // Adicionar classe active ao botão clicado
            this.classList.add('active');

            const period = this.getAttribute('data-period');
            filterScheduleByPeriod(period);
        });
    });
}

function filterScheduleByPeriod(period) {
    const scheduleItems = document.querySelectorAll('.schedule-item');

    scheduleItems.forEach(item => {
        if (period === 'all' || item.getAttribute('data-period') === period) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function renderScheduleGrid(appointments, selectedDate) {
    const container = document.querySelector('.schedule-container');
    if (!container) return;

    // Verificar dia da semana
    const dateObj = new Date(selectedDate + 'T00:00:00');
    const dayOfWeek = dateObj.getDay(); // 0 = Domingo, 1 = Segunda, etc.

    // Configuração dos horários de funcionamento baseado no dia
    // Slots de 15 minutos para maior granularidade
    let workingHours = { morning: [], afternoon: [] };
    let isClosed = false;

    if (dayOfWeek === 0 || dayOfWeek === 1) { // Domingo ou Segunda
        isClosed = true;
    } else if (dayOfWeek >= 2 && dayOfWeek <= 4) { // Terça a Quinta: 9h às 19h
        workingHours = {
            morning: generate15MinSlots('09:00', '12:00'),   // 9:00 até 12:00 (inclui 11:45)
            afternoon: generate15MinSlots('13:00', '19:00')  // 13:00 até 19:00 (inclui 18:45)
        };
    } else if (dayOfWeek === 5) { // Sexta: 8h às 19h
        workingHours = {
            morning: generate15MinSlots('08:00', '12:00'),   // 8:00 até 12:00
            afternoon: generate15MinSlots('13:00', '19:00')  // 13:00 até 19:00
        };
    } else if (dayOfWeek === 6) { // Sábado: 8h às 17h
        workingHours = {
            morning: generate15MinSlots('08:00', '12:00'),   // 8:00 até 12:00
            afternoon: generate15MinSlots('13:00', '17:00')  // 13:00 até 17:00
        };
    }

    // Criar mapa de agendamentos por horário - apenas para a data selecionada
    const appointmentMap = {};

    // Filtrar agendamentos para a data selecionada
    const dayAppointments = appointments.filter(appointment => {
        const appointmentDate = new Date(appointment.data_horario);
        const selectedDateObj = new Date(selectedDate + 'T00:00:00');

        const aptDateStr = appointmentDate.toISOString().split('T')[0];
        const selectedDateStr = selectedDate;



        // Comparar apenas a data (ano, mês, dia)
        return aptDateStr === selectedDateStr;
    });

    dayAppointments.forEach(appointment => {
        // Extrair horário de início do agendamento
        let startTime, endTime;

        if (appointment.horario_inicio) {
            startTime = formatTimeHHMM(appointment.horario_inicio);
            endTime = appointment.horario_fim ? formatTimeHHMM(appointment.horario_fim) : null;
        } else if (appointment.data_horario) {
            // Extrair horário da data_horario
            const appointmentDate = new Date(appointment.data_horario);
            const hours = appointmentDate.getHours().toString().padStart(2, '0');
            const minutes = appointmentDate.getMinutes().toString().padStart(2, '0');
            startTime = `${hours}:${minutes}`;

            // Se não tem horario_fim, calcular baseado na duração padrão (30 min)
            if (!appointment.horario_fim) {
                const endDate = new Date(appointmentDate.getTime() + 30 * 60000); // +30 minutos
                const endHours = endDate.getHours().toString().padStart(2, '0');
                const endMinutes = endDate.getMinutes().toString().padStart(2, '0');
                endTime = `${endHours}:${endMinutes}`;
            } else {
                endTime = formatTimeHHMM(appointment.horario_fim);
            }
        }

        if (startTime) {
            // Marcar todos os slots ocupados durante o período do agendamento
            const occupiedSlots = getOccupiedTimeSlots(startTime, endTime);

            occupiedSlots.forEach((slot, index) => {
                // Criar uma cópia do agendamento com informações adicionais
                const appointmentWithSlotInfo = {
                    ...appointment,
                    _slotStartTime: startTime,
                    _slotEndTime: endTime,
                    _isMainSlot: index === 0 // Primeiro slot é sempre o principal
                };

                appointmentMap[slot] = appointmentWithSlotInfo;
            });
        }
    });

    // Calcular estatísticas baseadas nos agendamentos do dia
    const totalSlots = isClosed ? 0 : (workingHours.morning.length + workingHours.afternoon.length);
    const occupiedSlots = dayAppointments.length;
    const availableSlots = totalSlots - occupiedSlots;
    const occupancyPercentage = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0;

    // Formatar data para exibição
    const dayOfWeekName = dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
    const formattedDate = dateObj.toLocaleDateString('pt-BR');

    // Se estiver fechado, mostrar mensagem
    if (isClosed) {
        container.innerHTML = `
            <div class="schedule-header">
                <div class="selected-date-info">
                    <h4>${formattedDate}</h4>
                    <div class="day-of-week">${dayOfWeekName}</div>
                </div>
            </div>
            <div class="closed-message">
                <div class="closed-icon">🚫</div>
                <h3>Barbearia Fechada</h3>
                <p>Domingo e Segunda-feira não funcionamos</p>
                <div class="working-hours-info">
                    <h4>Horários de Funcionamento:</h4>
                    <ul>
                        <li><strong>Terça a Quinta:</strong> 9h às 19h</li>
                        <li><strong>Sexta:</strong> 8h às 19h</li>
                        <li><strong>Sábado:</strong> 8h às 17h</li>
                        <li><strong>Domingo e Segunda:</strong> FECHADO</li>
                    </ul>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="schedule-header">
            <div class="selected-date-info">
                <h4>${formattedDate}</h4>
                <div class="day-of-week">${dayOfWeekName}</div>
            </div>
            <div class="schedule-legend">
                <div class="legend-item">
                    <div class="legend-color available"></div>
                    <span>Disponível</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color occupied"></div>
                    <span>Ocupado</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color closed"></div>
                    <span>Fechado</span>
                </div>
            </div>
        </div>

        <div class="time-periods">
            <div class="period-section">
                <h3 class="period-title">🌅 Manhã</h3>
                <div class="time-slots">
                    ${workingHours.morning.map(time => {
        const appointment = appointmentMap[time];
        const status = appointment ? 'occupied' : 'available';

        let timeDisplay = time;
        let clientDisplay = '';
        let isMainSlot = false;

        if (appointment) {
            // Usar a informação de slot principal/secundário que foi definida no mapeamento
            isMainSlot = appointment._isMainSlot || false;

            if (isMainSlot) {
                // Slot principal: mostrar período completo e nome do cliente
                if (appointment._slotEndTime) {
                    timeDisplay = `${appointment._slotStartTime} - ${appointment._slotEndTime}`;
                } else {
                    timeDisplay = time;
                }
                clientDisplay = `<div class="slot-client">${appointment.cliente_nome || appointment.nome_cliente || ''}</div>`;
            } else {
                // Slot secundário: mostrar apenas que está ocupado
                timeDisplay = time;
                clientDisplay = `<div class="slot-client">Ocupado</div>`;
            }
        }

        const slotClass = appointment ? (isMainSlot ? 'main-slot' : 'secondary-slot') : '';

        return `
                            <div class="time-slot ${status} ${slotClass}" data-time="${time}" onclick="handleTimeSlotClick('${time}', '${selectedDate}', ${appointment ? 'true' : 'false'})">
                                <div class="slot-time">${timeDisplay}</div>
                                ${clientDisplay}
                            </div>
                        `;
    }).join('')}
                </div>
            </div>

            <div class="period-section">
                <h3 class="period-title">🌇 Tarde</h3>
                <div class="time-slots">
                    ${workingHours.afternoon.map(time => {
        const appointment = appointmentMap[time];
        const status = appointment ? 'occupied' : 'available';

        let timeDisplay = time;
        let clientDisplay = '';
        let isMainSlot = false;

        if (appointment) {
            // Usar a informação de slot principal/secundário que foi definida no mapeamento
            isMainSlot = appointment._isMainSlot || false;

            if (isMainSlot) {
                // Slot principal: mostrar período completo e nome do cliente
                if (appointment._slotEndTime) {
                    timeDisplay = `${appointment._slotStartTime} - ${appointment._slotEndTime}`;
                } else {
                    timeDisplay = time;
                }
                clientDisplay = `<div class="slot-client">${appointment.cliente_nome || appointment.nome_cliente || ''}</div>`;
            } else {
                // Slot secundário: mostrar apenas que está ocupado
                timeDisplay = time;
                clientDisplay = `<div class="slot-client">Ocupado</div>`;
            }
        }

        const slotClass = appointment ? (isMainSlot ? 'main-slot' : 'secondary-slot') : '';

        return `
                            <div class="time-slot ${status} ${slotClass}" data-time="${time}" onclick="handleTimeSlotClick('${time}', '${selectedDate}', ${appointment ? 'true' : 'false'})">
                                <div class="slot-time">${timeDisplay}</div>
                                ${clientDisplay}
                            </div>
                        `;
    }).join('')}
                </div>
            </div>
        </div>

        <div class="schedule-summary">
            <div class="summary-stats">
                <div class="stat-item">
                    <span class="stat-number">${availableSlots}</span>
                    <span class="stat-label">Horários Livres</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${occupiedSlots}</span>
                    <span class="stat-label">Agendamentos</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${occupancyPercentage}%</span>
                    <span class="stat-label">Taxa de Ocupação</span>
                </div>
            </div>
        </div>
    `;
}

function renderClientsGrid(clients) {
    const container = document.getElementById('clientsGrid');
    container.innerHTML = '';

    clients.forEach(client => {
        const card = document.createElement('div');
        card.className = 'client-card';
        card.innerHTML = `
            <div class="client-name">${client.nome}</div>
            <div class="client-phone">${client.telefone}</div>
            <div class="client-stats">
                <span>Agendamentos: ${client.totalAgendamentos}</span>
                <span>Último: ${formatDate(client.ultimoAgendamento)}</span>
            </div>
        `;
        container.appendChild(card);
    });
}


// Variáveis globais para os gráficos
let revenueChartInstance = null;
let servicesChartInstance = null;
let statusChartInstance = null;
let hoursChartInstance = null;

function renderReports(data) {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js não carregado');
        return;
    }

    // Destruir gráficos anteriores se existirem
    if (revenueChartInstance) revenueChartInstance.destroy();
    if (servicesChartInstance) servicesChartInstance.destroy();
    if (statusChartInstance) statusChartInstance.destroy();
    if (hoursChartInstance) hoursChartInstance.destroy();

    const summaryContainer = document.getElementById('reportsSummaryCards');
    if (!summaryContainer) return;

    if (!data || data.length === 0) {
        summaryContainer.innerHTML = '<p class="no-data">Nenhum dado para exibir neste período.</p>';
        return;
    }

    // --- Processamento de Dados ---

    let totalRevenue = 0;
    let totalAppointments = data.length;
    let completedAppointments = 0;
    let paidAppointments = 0; // Contador para agendamentos efetivamente pagos

    const revenueByDate = {};
    const servicesCount = {};
    const statusCount = {};
    // Variável necessária para estatísticas gerais
    const statusStats = {};
    const hoursCount = new Array(24).fill(0);

    data.forEach(apt => {
        // Status
        const status = apt.status || 'agendado';
        statusCount[status] = (statusCount[status] || 0) + 1;
        statusStats[status] = (statusStats[status] || 0) + 1;

        if (status === 'concluido') {
            completedAppointments++;

            // Faturamento (APENAS concluídos E PAGOS - exclui inadimplentes)
            const statusPagamento = apt.pagamento || apt.status_pagamento;
            if (statusPagamento === 'pago') {
                paidAppointments++;
                const preco = parseFloat(apt.preco_cobrado || apt.preco || 0);
                totalRevenue += preco;

                // Faturamento por Data (apenas pagos)
                const dateKey = apt.data_horario ? apt.data_horario.split('T')[0] : 'N/A';
                revenueByDate[dateKey] = (revenueByDate[dateKey] || 0) + preco;
            }
        }

        // Serviços
        const serviceName = apt.servico_nome || apt.servico || 'Outros';
        servicesCount[serviceName] = (servicesCount[serviceName] || 0) + 1;

        // Horários
        if (apt.horario_inicio) {
            const hour = parseInt(apt.horario_inicio.split(':')[0]);
            if (!isNaN(hour) && hour >= 0 && hour < 24) {
                hoursCount[hour]++;
            }
        }
    });

    // Ticket médio baseado em agendamentos PAGOS, não apenas concluídos
    const averageTicket = paidAppointments > 0 ? totalRevenue / paidAppointments : 0;
    const completionRate = totalAppointments > 0 ? (completedAppointments / totalAppointments * 100) : 0;

    // --- Renderizar Cards de Resumo ---
    summaryContainer.innerHTML = `
        <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-calendar-check"></i></div>
            <div class="stat-info">
                <h4>Agendamentos</h4>
                <div class="stat-number">${totalAppointments}</div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-dollar-sign"></i></div>
            <div class="stat-info">
                <h4>Faturamento</h4>
                <div class="stat-number">R$ ${totalRevenue.toFixed(2)}</div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-receipt"></i></div>
            <div class="stat-info">
                <h4>Ticket Médio</h4>
                <div class="stat-number">R$ ${averageTicket.toFixed(2)}</div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-chart-line"></i></div>
            <div class="stat-info">
                <h4>Taxa de Conclusão</h4>
                <div class="stat-number">${completionRate.toFixed(1)}%</div>
            </div>
        </div>
    `;

    // --- Renderizar Gráficos ---

    // 1. Faturamento Diário (Line Chart)
    const sortedDates = Object.keys(revenueByDate).sort();
    const revenueCtx = document.getElementById('revenueChartCanvas');
    if (revenueCtx) {
        revenueChartInstance = new Chart(revenueCtx, {
            type: 'line',
            data: {
                labels: sortedDates.map(d => d.split('-').reverse().slice(0, 2).join('/')), // DD/MM
                datasets: [{
                    label: 'Faturamento (R$)',
                    data: sortedDates.map(d => revenueByDate[d]),
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        ticks: { color: '#aaa' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#aaa' }
                    }
                }
            }
        });
    }

    // 2. Horários de Pico (Bar Chart)
    const hoursCtx = document.getElementById('hoursChartCanvas');
    if (hoursCtx) {
        // Filtrar apenas horários com movimento para o gráfico ficar mais limpo
        const activeHours = hoursCount.map((count, hour) => ({ hour, count })).filter(item => item.count > 0);

        hoursChartInstance = new Chart(hoursCtx, {
            type: 'bar',
            data: {
                labels: activeHours.map(item => `${item.hour}h`),
                datasets: [{
                    label: 'Agendamentos',
                    data: activeHours.map(item => item.count),
                    backgroundColor: '#4FC3F7',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { stepSize: 1, color: '#aaa' } },
                    x: { grid: { display: false }, ticks: { color: '#aaa' } }
                }
            }
        });
    }

    // 3. Serviços (Doughnut)
    const servicesCtx = document.getElementById('servicesChartCanvas');
    if (servicesCtx) {
        const sortedServices = Object.entries(servicesCount).sort((a, b) => b[1] - a[1]);
        servicesChartInstance = new Chart(servicesCtx, {
            type: 'doughnut',
            data: {
                labels: sortedServices.map(s => s[0]),
                datasets: [{
                    data: sortedServices.map(s => s[1]),
                    backgroundColor: [
                        '#dc2626', '#4FC3F7', '#FFD54F', '#81C784', '#BA68C8'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#fff', boxWidth: 12 } }
                }
            }
        });
    }

    // 4. Status (Pie)
    const statusCtx = document.getElementById('statusChartCanvas');
    if (statusCtx) {
        statusChartInstance = new Chart(statusCtx, {
            type: 'pie',
            data: {
                labels: Object.keys(statusCount).map(s => s.charAt(0).toUpperCase() + s.slice(1)),
                datasets: [{
                    data: Object.values(statusCount),
                    backgroundColor: [
                        '#4FC3F7', // Agendado (Azul)
                        '#4CAF50', // Confirmado (Verde) -> ou Concluído? Depende do status real, mas aqui varia
                        '#9C27B0', // Concluído (Roxo)
                        '#f44336'  // Cancelado (Vermelho)
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { color: '#fff', boxWidth: 12 } }
                }
            }
        });
    }
    // --- Renderizar Tabela (Texto/Detalhes) ---
    // Preencher resumo textual (igual aos cards do gráfico, mas para o view de tabela)
    // --- Renderizar Tabela (Texto/Detalhes) ---
    const reportsGridText = document.getElementById('reportsGridText');
    if (reportsGridText) {
        let servicesHtml = '';
        Object.entries(servicesCount).forEach(([service, count]) => {
            servicesHtml += `<div class="stat-row"><span>${service}</span><span>${count}</span></div>`;
        });

        reportsGridText.innerHTML = `
            <div class="report-card">
                <h4><i class="fas fa-chart-line"></i> Resumo Financeiro</h4>
                <div class="stat-list">
                    <div class="stat-row"><span>Faturamento Total</span><span class="highlight">R$ ${totalRevenue.toFixed(2)}</span></div>
                    <div class="stat-row"><span>Ticket Médio</span><span>R$ ${averageTicket.toFixed(2)}</span></div>
                    <div class="stat-row"><span>Receita Líquida (Real)</span><span>R$ ${
            // Calcular receita líquida real iterando sobre os agendamentos concluídos E PAGOS
            data.filter(a => a.status === 'concluido' && (a.pagamento === 'pago' || a.status_pagamento === 'pago')).reduce((acc, curr) => {
                const val = parseFloat(curr.preco_cobrado || curr.preco || 0);
                const method = curr.forma_pagamento || 'dinheiro';
                return acc + calculateNetValue(val, method);
            }, 0).toFixed(2)
            }</span></div>
                    <div class="stat-row"><span>Taxas da Maquininha</span><span class="danger">- R$ ${
            // Calcular total de taxas pagas (Faturamento - Receita Líquida) - APENAS PAGOS
            data.filter(a => a.status === 'concluido' && (a.pagamento === 'pago' || a.status_pagamento === 'pago')).reduce((acc, curr) => {
                const val = parseFloat(curr.preco_cobrado || curr.preco || 0);
                const method = curr.forma_pagamento || 'dinheiro';
                const feePercent = PAYMENT_FEES[method] || 0;
                return acc + (val * feePercent / 100);
            }, 0).toFixed(2)
            }</span></div>
                </div>
            </div>

            <div class="report-card">
                <h4><i class="fas fa-calendar-check"></i> Agendamentos</h4>
                <div class="stat-list">
                    <div class="stat-row"><span>Total</span><span>${totalAppointments}</span></div>
                    <div class="stat-row"><span>Concluídos</span><span class="success">${statusStats.concluido || 0}</span></div>
                    <div class="stat-row"><span>Taxa de Conclusão</span><span>${completionRate.toFixed(1)}%</span></div>
                    <div class="stat-row"><span>Cancelados</span><span class="danger">${statusStats.cancelado || 0}</span></div>
                </div>
            </div>

            <div class="report-card">
                <h4><i class="fas fa-cut"></i> Serviços Realizados</h4>
                <div class="stat-list scrollable-list">
                    ${servicesHtml || '<div class="stat-row"><span>Nenhum serviço</span></div>'}
                </div>
            </div>
            
             <div class="report-card">
                <h4><i class="fas fa-info-circle"></i> Status Detalhado</h4>
                <div class="stat-list">
                     <div class="stat-row"><span>Agendados</span><span>${statusStats.agendado || 0}</span></div>
                     <div class="stat-row"><span>Confirmados</span><span>${statusStats.confirmado || 0}</span></div>
                     <div class="stat-row"><span>Concluídos</span><span>${statusStats.concluido || 0}</span></div>
                </div>
            </div>
        `;
    }
}

// Variável de estado para o view (padrão false = tabela)
let isGraphView = false;

function toggleReportsView() {
    isGraphView = !isGraphView;
    const btn = document.getElementById('toggleViewBtn');
    const tableView = document.getElementById('reportsTableView');
    const graphView = document.getElementById('reportsGraphView');

    if (isGraphView) {
        tableView.style.display = 'none';
        graphView.style.display = 'block';
        btn.innerHTML = '<i class="fas fa-table"></i> Ver Tabela';
        btn.classList.add('active');
        // Forçar resize dos gráficos ao mostrar
        if (revenueChartInstance) revenueChartInstance.resize();
        if (hoursChartInstance) hoursChartInstance.resize();
        if (servicesChartInstance) servicesChartInstance.resize();
        if (statusChartInstance) statusChartInstance.resize();
    } else {
        tableView.style.display = 'block';
        graphView.style.display = 'none';
        btn.innerHTML = '<i class="fas fa-chart-pie"></i> Ver Gráficos';
        btn.classList.remove('active');
    }
}

// Expor função globalmente
window.toggleReportsView = toggleReportsView;

// Utilitários
function formatDate(dateString) {
    if (!dateString) return 'N/A';

    try {
        let date;

        // Se já é um objeto Date
        if (dateString instanceof Date) {
            date = dateString;
        }
        // Se é uma string ISO completa (com horário)
        else if (typeof dateString === 'string' && dateString.includes('T')) {
            date = new Date(dateString);
        }
        // Se é uma string de data simples (YYYY-MM-DD)
        else if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
            date = new Date(dateString + 'T00:00:00');
        }
        // Outros formatos
        else {
            date = new Date(dateString);
        }

        // Verificar se a data é válida
        if (isNaN(date.getTime())) {
            return 'Data inválida';
        }

        return date.toLocaleDateString('pt-BR');
    } catch (error) {
        console.error('Erro ao formatar data:', error, dateString);
        return 'Data inválida';
    }
}

function setDateToToday(inputId = 'currentDate') {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById(inputId);
    if (dateInput) {
        dateInput.value = today;

        // Disparar evento de mudança para atualizar os dados
        if (inputId === 'currentDate') {
            loadOverviewData();
        } else if (inputId === 'scheduleDate') {
            loadScheduleGrid();
        }
    }
}

function setDateToTomorrow(inputId = 'scheduleDate') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const dateInput = document.getElementById(inputId);
    if (dateInput) {
        dateInput.value = tomorrowStr;

        // Disparar evento de mudança para atualizar os dados
        if (inputId === 'scheduleDate') {
            loadScheduleGrid();
        }
    }
}

// Função otimizada com debounce para filtrar clientes
const debouncedFilterClients = debounce(() => {
    const searchTerm = document.getElementById('clientSearch')?.value?.toLowerCase() || '';
    const clientCards = document.querySelectorAll('.client-card');

    clientCards.forEach(card => {
        const clientName = card.querySelector('.client-name')?.textContent?.toLowerCase() || '';
        const clientPhone = card.querySelector('.client-phone')?.textContent?.toLowerCase() || '';

        const shouldShow = !searchTerm || clientName.includes(searchTerm) || clientPhone.includes(searchTerm);
        card.style.display = shouldShow ? 'block' : 'none';
    });
}, 300);

// Função legacy mantida para compatibilidade
function filterClients() {
    debouncedFilterClients();
}

function updateReportData() {
    loadReports();
}

function filterAppointments() {
    const searchTerm = document.getElementById('searchInput')?.value?.toLowerCase() || '';
    // Esta função pode ser implementada se necessário
}

function updateReportData() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;

    if (startDate && endDate) {
        loadReports();
    }
}

// Modal de edição
async function editAppointment(id) {
    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível editar agendamento');
        showNotification('Erro: Supabase não configurado. Configure o arquivo config.js', 'error');
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('agendamentos')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        const appointment = data;

        // Preencher campos do modal
        document.getElementById('editId').value = appointment.id;

        // Extrair data e horário do timestamp
        const appointmentDate = new Date(appointment.data_horario);
        document.getElementById('editData').value = appointmentDate.toISOString().split('T')[0];

        // Garantir formato HH:MM para o horário de início
        let timeStartValue = appointment.horario_inicio;
        if (!timeStartValue) {
            const hours = appointmentDate.getHours().toString().padStart(2, '0');
            const minutes = appointmentDate.getMinutes().toString().padStart(2, '0');
            timeStartValue = `${hours}:${minutes}`;
        }
        // Remover segundos se existirem (formato HH:MM:SS -> HH:MM)
        if (timeStartValue.includes(':') && timeStartValue.split(':').length === 3) {
            timeStartValue = timeStartValue.substring(0, 5);
        }
        document.getElementById('editHorarioInicio').value = timeStartValue;

        // Garantir formato HH:MM para o horário de fim
        let timeEndValue = appointment.horario_fim;
        if (!timeEndValue) {
            // Se não tiver horário de fim, calcular baseado no início + 30 min
            timeEndValue = calculateEndTime(timeStartValue, 30);
        }
        // Remover segundos se existirem (formato HH:MM:SS -> HH:MM)
        if (timeEndValue.includes(':') && timeEndValue.split(':').length === 3) {
            timeEndValue = timeEndValue.substring(0, 5);
        }
        document.getElementById('editHorarioFim').value = timeEndValue;

        // Preencher nome e telefone do cliente (compatível com agendamentos ou view)
        document.getElementById('editNome').value = appointment.nome_cliente || appointment.cliente_nome || '';

        // Preencher campos de telefone segmentados
        const telefoneCompleto = appointment.telefone || appointment.cliente_telefone || '';
        document.getElementById('editTelefone').value = telefoneCompleto;
        desmembrarTelefone(telefoneCompleto, 'editDDD', 'editNumero');

        document.getElementById('editServico').value = appointment.servico || appointment.servico_nome || '';
        document.getElementById('editStatus').value = appointment.status || 'agendado';
        document.getElementById('editObservacoes').value = appointment.observacoes || '';
        document.getElementById('editPreco').value = (appointment.preco || appointment.preco_cobrado) || '';

        // Preencher Forma de Pagamento
        document.getElementById('editFormaPagamento').value = appointment.forma_pagamento || '';
        togglePaymentMethodVisibility('edit');

        // Mostrar modal
        document.getElementById('editModal').style.display = 'block';
    } catch (error) {
        console.error('Erro ao carregar agendamento:', error);
        showNotification('Erro ao carregar dados do agendamento: ' + error.message, 'error');
    }
}

async function saveAppointment() {
    // Salvando agendamento...

    try {
        // Obter dados do formulário
        const id = document.getElementById('editId').value;
        const clienteNome = document.getElementById('editNome').value.trim();
        let clienteTelefone = document.getElementById('editTelefone').value.trim();

        // Formatar telefone antes de enviar
        clienteTelefone = formatarTelefone(clienteTelefone);

        const data = document.getElementById('editData').value;
        const horarioInicio = document.getElementById('editHorarioInicio').value;
        const horarioFim = document.getElementById('editHorarioFim').value;
        const servico = document.getElementById('editServico').value;
        const status = document.getElementById('editStatus').value;
        const observacoes = document.getElementById('editObservacoes').value.trim();
        const precoElement = document.getElementById('editPreco');
        const precoValue = precoElement?.value;
        const preco = parseFloat(precoValue || 0);

        // Validando dados do formulário

        // Validação do telefone (DDD + Número)
        const editDDD = document.getElementById('editDDD')?.value.trim() || '';
        const editNumero = document.getElementById('editNumero')?.value.replace(/\D/g, '') || '';

        // Validações básicas
        if (!id || !clienteNome || !data || !horarioInicio || !horarioFim || !servico) {
            showNotification('Por favor, preencha todos os campos obrigatórios.', 'error');
            return;
        }

        // Telefone agora é opcional - apenas validar se foi preenchido


        // Se preencheu parcialmente, avisa mas não bloqueia
        if ((editDDD && !editNumero) || (!editDDD && editNumero)) {
            showNotification('Telefone incompleto. Preencha DDD e número ou deixe ambos em branco.', 'warning');
        }

        // Validar formato dos horários (HH:MM)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(horarioInicio) || !timeRegex.test(horarioFim)) {
            showNotification('Formato de horário inválido. Use HH:MM (ex: 14:30)', 'error');
            return;
        }

        // Validar se horário de fim é posterior ao de início
        if (horarioFim <= horarioInicio) {
            showNotification('O horário de fim deve ser posterior ao horário de início.', 'error');
            return;
        }

        // Combinar data e horário em um timestamp válido
        const dataHorario = new Date(`${data}T${horarioInicio}:00`);

        // Verificar se a data é válida
        if (isNaN(dataHorario.getTime())) {
            showNotification('Data ou horário inválido', 'error');
            return;
        }

        if (!supabaseClient) {
            console.error('Supabase não configurado - não é possível salvar agendamento');
            showNotification('Erro: Supabase não configurado. Configure o arquivo config.js', 'error');
            return;
        }

        // Salvando no Supabase

        // Verificar conflitos de horário no Supabase (excluindo o próprio agendamento)
        const conflictCheck = await checkTimeConflictSupabase(data, horarioInicio, horarioFim, id);
        if (conflictCheck.conflict) {
            showNotification(`Este horário conflita com o agendamento de ${conflictCheck.conflictWith.cliente_nome} (${conflictCheck.conflictWith.horario_inicio} - ${conflictCheck.conflictWith.horario_fim}). Por favor, escolha outro horário.`, 'error');
            return;
        }

        // Buscar ou criar cliente
        const cliente = await findOrCreateClient(clienteTelefone, clienteNome);
        if (!cliente) {
            throw new Error('Erro ao processar dados do cliente');
        }

        // Buscar serviço
        const servicoData = services.find(s => s.nome === servico);
        if (!servicoData) {
            throw new Error('Serviço não encontrado');
        }

        // Preparar dados para o Supabase (usar `preco` conforme schema)
        // Obter forma de pagamento e calcular valor líquido
        const formaPagamento = status === 'concluido' ? (document.getElementById('editFormaPagamento')?.value || 'dinheiro') : null;
        const taxaAplicada = formaPagamento ? (PAYMENT_FEES[formaPagamento] || 0) : 0;
        const valorLiquido = formaPagamento ? calculateNetValue(preco, formaPagamento) : preco;

        const updatedData = {
            cliente_id: cliente.id,
            servico_id: servicoData.id,
            // IMPORTANTES: Campos diretos para compatibilidade com bot
            telefone: clienteTelefone || '',  // Pode ser vazio agora
            nome_cliente: clienteNome,
            servico: servico,
            // Campos de data/hora
            data_horario: dataHorario.toISOString(),
            horario_inicio: horarioInicio,
            horario_fim: horarioFim,
            // Campos de serviço
            preco: preco,
            status: status,
            observacoes: observacoes || null,
            // Campos financeiros (InfinitePay)
            forma_pagamento: formaPagamento,
            valor_liquido: valorLiquido,
            taxa_aplicada: taxaAplicada
        };

        // Dados preparados para atualização

        const { data: result, error } = await supabaseClient
            .from('agendamentos')
            .update(updatedData)
            .eq('id', parseInt(id))
            .select();

        // Se o agendamento foi concluído e há valor a pagar, criar registro de pagamento
        if (status === 'concluido' && preco > 0) {
            const valorPago = pagamento === 'pago' ? preco : 0;
            const valorPendente = preco - valorPago;

            // Verificar se já existe um pagamento para este agendamento
            const { data: existingPayment } = await supabaseClient
                .from('pagamentos')
                .select('id')
                .eq('agendamento_id', parseInt(id))
                .single();

            const paymentData = {
                agendamento_id: parseInt(id),
                cliente_id: cliente.id,
                valor_total: preco,
                valor_pago: valorPago,
                valor_pendente: valorPendente,
                status: pagamento === 'pago' ? 'pago' : 'pendente',
                forma_pagamento: formaPagamento || null,
                data_pagamento: pagamento === 'pago' ? new Date().toISOString() : null
            };

            if (existingPayment) {
                // Atualizar pagamento existente
                await supabaseClient
                    .from('pagamentos')
                    .update(paymentData)
                    .eq('id', existingPayment.id);
            } else {
                // Criar novo pagamento
                await supabaseClient
                    .from('pagamentos')
                    .insert(paymentData);
            }
        }

        if (error) {
            // Erro do Supabase
            throw error;
        }

        // Atualização concluída

        closeModal();
        loadAppointments();
        loadTodayAppointments();
        loadOverviewData();
        loadScheduleGrid();

        showNotification('Agendamento atualizado com sucesso!', 'success');
        // Agendamento salvo com sucesso

    } catch (error) {
        console.error('Erro ao salvar agendamento:', error);
        showNotification('Erro ao salvar agendamento: ' + (error.message || 'Erro desconhecido'), 'error');
    }
}

async function deleteAppointment(id) {
    if (!confirm('Tem certeza que deseja excluir este agendamento?')) {
        return;
    }

    // Excluindo agendamento...

    try {
        if (!supabaseClient) {
            console.error('Supabase não configurado - não é possível excluir agendamento');
            showNotification('Erro: Supabase não configurado. Configure o arquivo config.js', 'error');
            return;
        }

        // Excluindo do Supabase

        const { data: result, error } = await supabaseClient
            .from('agendamentos')
            .delete()
            .eq('id', parseInt(id));

        if (error) {
            // Erro do Supabase
            throw error;
        }

        // Exclusão concluída

        // Recarregar todas as visualizações
        await loadAppointments();
        await loadTodayAppointments();
        await loadOverviewData();
        await loadScheduleGrid();
        await loadAllClients(); // Recarregar clientes também

        showNotification('Agendamento excluído com sucesso!', 'success');
        // Agendamento excluído com sucesso

    } catch (error) {
        console.error('Erro ao excluir agendamento:', error);
        showNotification('Erro ao excluir agendamento: ' + (error.message || 'Erro desconhecido'), 'error');
    }
}

// Função para excluir cliente (versão antiga - mantida para compatibilidade)
async function deleteClientOld(telefone) {
    if (!confirm('Tem certeza que deseja excluir este cliente? Todos os agendamentos relacionados também serão excluídos.')) {
        return;
    }

    try {
        if (!supabaseClient) {
            showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
            return;
        }

        showLoading();

        // Buscar cliente pelo telefone
        const normalizedPhone = normalizePhone(telefone);
        const { data: clientData, error: clientError } = await supabaseClient
            .from('clientes')
            .select('id, nome')
            .eq('telefone', normalizedPhone)
            .single();

        if (clientError && clientError.code !== 'PGRST116') {
            throw clientError;
        }

        if (clientData) {
            // Usar a nova função de exclusão
            await deleteClient(clientData.id, clientData.nome);
        } else {
            showNotification('Cliente não encontrado.', 'warning');
        }

    } catch (error) {
        console.error('Erro ao excluir cliente:', error);
        showNotification('Erro ao excluir cliente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function closeModal() {
    document.getElementById('editModal').style.display = 'none';
    selectedClientId = null;

    // Limpar sugestões
    const suggestionsContainer = document.getElementById('clientSuggestions');
    if (suggestionsContainer) {
        suggestionsContainer.style.display = 'none';
    }
}

// Loading
function showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// Variáveis globais para o sistema de clientes
let allClients = [];
let selectedClientId = null;
let clientsCacheTimestamp = 0;
const CLIENTS_CACHE_TTL = 60000; // 1 minuto de cache

// Função otimizada para carregar todos os clientes (com cache)
async function loadAllClients(forceRefresh = false) {
    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar clientes');
        return [];
    }

    // Usar cache se ainda válido
    const now = Date.now();
    if (!forceRefresh && allClients.length > 0 && (now - clientsCacheTimestamp) < CLIENTS_CACHE_TTL) {
        return allClients;
    }

    try {
        // Buscar clientes da tabela clientes (apenas campos necessários para performance)
        const { data, error } = await supabaseClient
            .from('clientes')
            .select('id, nome, telefone, telefone_normalizado')
            .eq('status_cliente', 'ativo')
            .order('nome')
            .limit(1000); // Limitar para performance

        if (error) throw error;

        allClients = data || [];
        clientsCacheTimestamp = now;

        return allClients;
    } catch (error) {
        console.error('Erro ao carregar clientes:', error);
        return allClients; // Retornar cache anterior em caso de erro
    }
}

// Função para configurar o autocomplete de clientes
function setupClientAutocomplete() {
    const clientInput = document.getElementById('editNome');
    const suggestionsContainer = document.getElementById('clientSuggestions');

    if (!clientInput || !suggestionsContainer) return;

    let selectedIndex = -1;

    clientInput.addEventListener('input', function () {
        const query = this.value.trim().toLowerCase();
        selectedClientId = null;

        if (query.length < 2) {
            suggestionsContainer.style.display = 'none';
            return;
        }

        const filteredClients = allClients.filter(client =>
            client.nome.toLowerCase().includes(query) ||
            (client.telefone || '').toLowerCase().includes(query)
        );

        if (filteredClients.length === 0) {
            suggestionsContainer.style.display = 'none';
            return;
        }

        suggestionsContainer.innerHTML = '';
        filteredClients.forEach((client, index) => {
            const suggestion = document.createElement('div');
            suggestion.className = 'client-suggestion';
            suggestion.innerHTML = `
                <div class="client-suggestion-name">${client.nome}</div>
                <div class="client-suggestion-phone">${client.telefone}</div>
            `;

            suggestion.addEventListener('click', () => {
                selectClient(client);
            });

            suggestionsContainer.appendChild(suggestion);
        });

        suggestionsContainer.style.display = 'block';
        selectedIndex = -1;
    });

    // Navegação com teclado
    clientInput.addEventListener('keydown', function (e) {
        const suggestions = suggestionsContainer.querySelectorAll('.client-suggestion');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
            updateSelectedSuggestion(suggestions);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion(suggestions);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                const clientName = suggestions[selectedIndex].querySelector('.client-suggestion-name').textContent;
                const clientPhone = suggestions[selectedIndex].querySelector('.client-suggestion-phone').textContent;
                const client = allClients.find(c => c.nome === clientName && c.telefone === clientPhone);
                if (client) {
                    selectClient(client);
                }
            }
        } else if (e.key === 'Escape') {
            suggestionsContainer.style.display = 'none';
            selectedIndex = -1;
        }
    });

    // Fechar sugestões ao clicar fora
    document.addEventListener('click', function (e) {
        if (!clientInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
            suggestionsContainer.style.display = 'none';
            selectedIndex = -1;
        }
    });

    function updateSelectedSuggestion(suggestions) {
        suggestions.forEach((suggestion, index) => {
            suggestion.classList.toggle('selected', index === selectedIndex);
        });
    }

    function selectClient(client) {
        clientInput.value = client.nome;
        selectedClientId = client.id;
        suggestionsContainer.style.display = 'none';
        selectedIndex = -1;

        // Preencher telefone automaticamente se houver campo
        const phoneField = document.getElementById('editTelefone');
        if (phoneField) {
            phoneField.value = client.telefone;
        }
    }
}

// Função para buscar nome do cliente por telefone
async function getClientNameByPhone(phone) {
    if (!supabaseClient) {
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

// Funções de renderização removidas - usando a função principal

// Função renderTodaySchedule removida - usando a função principal

function renderClientsGrid(clients) {
    const container = document.getElementById('clientsGrid');
    if (!container) return;

    container.innerHTML = '';

    clients.forEach(client => {
        const card = document.createElement('div');
        card.className = 'client-card';

        // Formatar telefone para exibição
        const formattedPhone = formatPhoneDisplay(client.telefone);

        card.innerHTML = `
            <div class="client-header">
                <h4>${client.nome}</h4>
                <button class="client-delete-btn" onclick="deleteClient(${client.id}, '${client.nome}')" title="Excluir Cliente">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="client-info">
                <p><strong>Telefone:</strong> <span class="client-phone">${formattedPhone}</span></p>
                <p><strong>Total de Agendamentos:</strong> ${client.totalAgendamentos || 0}</p>
                <p><strong>Último Agendamento:</strong> ${client.ultimoAgendamento ? new Date(client.ultimoAgendamento).toLocaleDateString('pt-BR') : 'Nunca'}</p>
            </div>
        `;
        container.appendChild(card);
    });
}



// Função para mostrar notificações
function showNotification(message, type = 'info') {
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

// Função para abrir modal de adicionar agendamento
function openAddAppointmentModal() {
    // Definir data de hoje por padrão
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('addData').value = today;

    // Resetar cliente selecionado
    selectedAddClientId = null;

    // Limpar campos
    document.getElementById('addNome').value = '';
    document.getElementById('addTelefone').value = '';
    document.getElementById('addDDD').value = '';
    document.getElementById('addNumero').value = '';
    document.getElementById('addServico').value = '';
    document.getElementById('addHorarioInicio').value = '';
    document.getElementById('addHorarioFim').value = '';
    document.getElementById('addPreco').value = '';
    document.getElementById('addStatus').value = 'agendado';
    document.getElementById('addObservacoes').value = '';

    // Mostrar modal
    document.getElementById('addModal').style.display = 'block';
}

// Função para fechar modal de adicionar agendamento
function closeAddModal() {
    document.getElementById('addModal').style.display = 'none';
    selectedAddClientId = null;
}

// Função para atualizar preço baseado no serviço selecionado (modal adicionar)
function updateAddServicePrice() {
    const servicoSelect = document.getElementById('addServico');
    const precoInput = document.getElementById('addPreco');

    // Limpar o campo de preço para que o barbeiro defina
    if (servicoSelect.value) {
        precoInput.value = '';
        precoInput.focus();
    } else {
        precoInput.value = '';
    }
}

// Função para atualizar preço baseado no serviço selecionado (modal editar)
function updateEditServicePrice() {
    const servicoSelect = document.getElementById('editServico');
    const precoInput = document.getElementById('editPreco');

    // Limpar o campo de preço para que o barbeiro defina
    if (servicoSelect.value) {
        precoInput.focus();
    }
}

// Função para atualizar preço baseado no serviço selecionado (modal inadimplentes)
function updateUnpaidServicePrice() {
    const servicoSelect = document.getElementById('addUnpaidServico');
    const precoInput = document.getElementById('addUnpaidValor');

    // Limpar o campo de preço para que o barbeiro defina
    if (servicoSelect.value && precoInput) {
        precoInput.value = '';
        precoInput.focus();
    }
}

// Função para adicionar novo agendamento (USA RPC SEGURA)
async function addNewAppointment(event) {
    event.preventDefault();

    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível criar agendamento');
        showNotification('Erro: Supabase não configurado. Configure o arquivo config.js', 'error');
        return;
    }

    try {
        const clienteNome = document.getElementById('addNome').value.trim();
        let clienteTelefone = document.getElementById('addTelefone').value.trim();

        // Formatar telefone antes de enviar
        clienteTelefone = formatarTelefone(clienteTelefone);

        const servico = document.getElementById('addServico').value;
        const data = document.getElementById('addData').value;
        const horarioInicio = document.getElementById('addHorarioInicio').value;
        const horarioFim = document.getElementById('addHorarioFim').value;
        const preco = parseFloat(document.getElementById('addPreco').value) || 0;
        const observacoes = document.getElementById('addObservacoes').value.trim();
        const status = document.getElementById('addStatus').value;
        const formaPagamento = document.getElementById('addFormaPagamento').value;

        // Validação centralizada
        const validation = validateAppointmentData({
            nome: clienteNome,
            telefone: clienteTelefone,
            servico,
            data,
            horarioInicio,
            horarioFim,
            preco
        });

        if (!validation.valid) {
            showNotification(validation.errors[0], 'error');
            return;
        }

        // Validação do telefone (DDD + Número) - OPCIONAL
        const ddd = document.getElementById('addDDD')?.value.trim() || '';
        const numero = document.getElementById('addNumero')?.value.replace(/\D/g, '') || '';

        // Telefone é opcional - apenas avisa se preencheu incompleto
        if ((ddd && !numero) || (!ddd && numero)) {
            showNotification('Telefone incompleto. Preencha DDD e número ou deixe ambos em branco.', 'warning');
            // Não bloqueia, apenas avisa
        }

        let cliente;

        // Se um cliente foi selecionado pelo autocomplete, usar ele diretamente
        if (selectedAddClientId) {
            const { data: existingClient, error: clientError } = await supabaseClient
                .from('clientes')
                .select('*')
                .eq('id', selectedAddClientId)
                .single();

            if (clientError || !existingClient) {
                cliente = await findOrCreateClient(clienteTelefone, clienteNome);
            } else {
                cliente = existingClient;
            }
        } else {
            cliente = await findOrCreateClient(clienteTelefone, clienteNome);
        }

        if (!cliente) {
            throw new Error('Erro ao processar dados do cliente');
        }

        // Buscar serviço
        const servicoData = services.find(s => s.nome === servico);
        if (!servicoData) {
            throw new Error('Serviço não encontrado');
        }

        // Combinar data e horário em um timestamp
        const dataHorario = new Date(`${data}T${horarioInicio}:00`);

        // USAR RPC SEGURA (Atomicidade no banco - previne conflitos)
        const result = await handleSecureBooking({
            clienteId: cliente.id,
            servicoId: servicoData.id,
            telefone: clienteTelefone,
            nome: clienteNome,
            servico: servico,
            dataISO: dataHorario.toISOString(),
            inicio: horarioInicio,
            fim: horarioFim,
            preco: preco
        });

        console.log('Agendamento criado via RPC:', result);

        // Se o status for diferente de agendado ou tiver pagamento, atualizar o registro
        if ((status && status !== 'agendado') || (status === 'concluido' && formaPagamento)) {
            const agendamentoId = result.agendamento_id || result.id; // Garantir ID

            if (agendamentoId) {
                const updateData = {
                    status: status,
                    observacoes: observacoes
                };

                if (status === 'concluido' && formaPagamento) {
                    updateData.forma_pagamento = formaPagamento;
                    updateData.valor_liquido = calculateNetValue(preco, formaPagamento);
                    updateData.taxa_aplicada = PAYMENT_FEES[formaPagamento] || 0;
                    updateData.valor_pago = preco; // Assume pago integral
                    updateData.status_pagamento = 'pago'; // Assume pago
                } else if (status === 'concluido') {
                    // Se não selecionou pagamento mas concluiu, usar dinheiro/default
                    updateData.forma_pagamento = 'dinheiro';
                    updateData.valor_liquido = preco;
                    updateData.taxa_aplicada = 0;
                    updateData.valor_pago = preco;
                    updateData.status_pagamento = 'pago';
                }

                await supabaseClient
                    .from('agendamentos')
                    .update(updateData)
                    .eq('id', agendamentoId);
            }
        } else if (observacoes) {
            // Se só tiver observações para atualizar (já que a RPC talvez não pegue obs ou status)
            const agendamentoId = result.agendamento_id || result.id;
            if (agendamentoId) {
                await supabaseClient
                    .from('agendamentos')
                    .update({ observacoes: observacoes })
                    .eq('id', agendamentoId);
            }
        }

        // Fechar modal e recarregar dados
        closeAddModal();
        loadAppointments();
        loadTodayAppointments();
        loadOverviewData();
        loadScheduleGrid();

        showNotification('Agendamento criado com sucesso!', 'success');

    } catch (error) {
        console.error('Erro ao adicionar agendamento:', error);

        // Mensagem amigável para conflito de horário
        if (error.message.includes('CONFLITO') || error.message.includes('Horário indisponível')) {
            showNotification('Putz, esse horário acabou de ser ocupado. Por favor, escolha outro!', 'warning');
        } else {
            showNotification('Erro ao criar agendamento: ' + error.message, 'error');
        }
    }
}
function handleTimeSlotClick(time, date, isOccupied) {
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

// Função para definir data para hoje
function setToday() {
    const today = new Date();
    const todayString = today.toISOString().split('T')[0];
    document.getElementById('scheduleDate').value = todayString;
    loadScheduleGrid();
}

// Função para definir data para amanhã
function setTomorrow() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowString = tomorrow.toISOString().split('T')[0];
    document.getElementById('scheduleDate').value = tomorrowString;
    loadScheduleGrid();
}

// Fechar modal ao clicar fora
window.onclick = function (event) {
    const modal = document.getElementById('editModal');
    if (event.target === modal) {
        closeModal();
    }
}

// Adicionar event listeners quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', function () {
    // Tornar funções disponíveis globalmente
    window.editAppointment = editAppointment;
    window.deleteAppointment = deleteAppointment;
    window.updateEditServicePrice = updateEditServicePrice;

    // Event listener para o formulário de edição
    const editForm = document.getElementById('editForm');
    if (editForm) {
        editForm.addEventListener('submit', function (event) {
            event.preventDefault();
            saveAppointment();
        });
    }

    // Event listener para tecla Enter no modal de edição
    const editModal = document.getElementById('editModal');
    if (editModal) {
        editModal.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                // Permitir Enter em textarea
                if (event.target.tagName.toLowerCase() === 'textarea') {
                    return;
                }
                event.preventDefault();
                saveAppointment();
            }
            if (event.key === 'Escape') {
                closeModal();
            }
        });
    }

    // Melhorar o botão de salvar
    const saveButton = document.querySelector('#editModal .btn-save');
    if (saveButton) {
        saveButton.addEventListener('click', function (event) {
            event.preventDefault();
            saveAppointment();
        });
    }

    // Funções disponíveis globalmente
});

// ==================== FUNÇÕES PARA INADIMPLENTES ====================

// Função para carregar clientes inadimplentes
async function loadUnpaidClients() {
    if (!supabaseClient) {
        console.error('Supabase não configurado - não é possível carregar inadimplentes');
        showNotification('Erro: Supabase não configurado. Configure o arquivo config.js', 'error');
        return;
    }

    try {
        showLoading();

        // Primeiro, atualizar a lista de inadimplentes
        await updateUnpaidList();

        const filterClient = document.getElementById('unpaidClientFilter').value.trim();

        // Buscar inadimplentes com JOIN nas tabelas
        let query = supabaseClient
            .from('inadimplentes')
            .select(`
                *,
                clientes(nome, telefone),
                agendamentos(data_horario, servico, servicos(nome))
            `)
            .eq('status_cobranca', 'pendente')
            .gt('valor_restante', 0)
            .order('dias_atraso', { ascending: false });

        // Filtrar por cliente se especificado
        if (filterClient) {
            query = query.or(`clientes.nome.ilike.%${filterClient}%,clientes.telefone.ilike.%${filterClient}%`);
        }

        const { data, error } = await query;

        if (error) throw error;

        const unpaidClients = data || [];
        renderUnpaidTable(unpaidClients);
        updateUnpaidSummary(unpaidClients);

    } catch (error) {
        console.error('Erro ao carregar inadimplentes:', error);
        showNotification('Erro ao carregar clientes inadimplentes: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Função para atualizar lista de inadimplentes no banco
async function updateUnpaidList() {
    if (!supabaseClient) return;

    try {
        // Buscar inadimplentes com dados do agendamento para calcular dias de atraso corretamente
        const { data: inadimplentes, error } = await supabaseClient
            .from('inadimplentes')
            .select(`
                *,
                agendamentos(data_horario)
            `)
            .neq('status_cobranca', 'quitado');

        if (error) throw error;

        // Atualizar dias de atraso para cada inadimplente baseado na data do serviço
        for (const inadimplente of inadimplentes || []) {
            // Usar data do agendamento se existir, senão usar data_vencimento
            let dataServico;
            if (inadimplente.agendamentos?.data_horario) {
                dataServico = new Date(inadimplente.agendamentos.data_horario);
            } else if (inadimplente.data_vencimento) {
                dataServico = new Date(inadimplente.data_vencimento + 'T00:00:00');
            } else {
                continue; // Sem data para calcular
            }

            const hoje = new Date();
            const diasAtraso = Math.max(0, Math.floor((hoje - dataServico) / (1000 * 60 * 60 * 24)));

            if (diasAtraso !== inadimplente.dias_atraso) {
                await supabaseClient
                    .from('inadimplentes')
                    .update({ dias_atraso: diasAtraso })
                    .eq('id', inadimplente.id);
            }
        }

        // Lista atualizada com sucesso
    } catch (error) {
        console.error('Erro ao atualizar lista de inadimplentes:', error);
    }
}



// Função para renderizar tabela de inadimplentes
function renderUnpaidTable(unpaidClients) {
    const tbody = document.getElementById('unpaidTableBody');
    if (!tbody) return;

    if (unpaidClients.length === 0) {
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

    tbody.innerHTML = unpaidClients.map(client => {
        // Lidar com agendamentos nulos (inadimplência independente)
        const hasAgendamento = client.agendamentos && client.agendamentos.data_horario;

        // Usar data do agendamento se existir, senão usar data_vencimento da inadimplência
        const serviceDate = hasAgendamento
            ? new Date(client.agendamentos.data_horario)
            : new Date(client.data_vencimento + 'T00:00:00');

        // Usar nome do cliente da tabela clientes ou do campo direto na inadimplentes
        const clienteNome = client.clientes?.nome || client.nome_cliente || 'Cliente não identificado';
        const clienteTelefone = client.clientes?.telefone || client.telefone || '';

        // Usar serviço do agendamento ou campo direto da inadimplência
        const servicoNome = hasAgendamento && client.agendamentos.servicos?.nome
            ? client.agendamentos.servicos.nome
            : (client.servico || 'Serviço não especificado');

        const overdueClass = client.dias_atraso > 30 ? 'critical' : '';

        // Para inadimplência independente, usar o id da inadimplência
        const inadimplenteId = client.id;
        const agendamentoId = client.agendamento_id;

        return `
            <tr>
                <td>${clienteNome}</td>
                <td>${formatPhoneDisplay(clienteTelefone)}</td>
                <td>${servicoNome}</td>
                <td>${serviceDate.toLocaleDateString('pt-BR')}</td>
                <td>R$ ${(client.valor_devido || 0).toFixed(2)}</td>
                <td>
                    <span class="overdue-days ${overdueClass}">
                        ${client.dias_atraso || 0} dias
                    </span>
                </td>
                <td>
                    <div class="unpaid-actions">
                        <button class="mark-paid-btn" onclick="markAsPaidByInadimplente(${inadimplenteId})">
                            <i class="fas fa-check"></i>
                            Marcar Pago
                        </button>
                        <button class="btn-edit" onclick="openEditUnpaidModal(${inadimplenteId})">
                            <i class="fas fa-edit"></i>
                            Editar
                        </button>
                        <button class="btn-delete" onclick="deleteUnpaidClient(${inadimplenteId})">
                            <i class="fas fa-trash"></i>
                            Excluir
                        </button>
                        <button class="contact-btn" onclick="contactClient('${clienteTelefone}', '${clienteNome}', ${agendamentoId || 'null'})">
                            <i class="fas fa-phone"></i>
                            Contatar
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Função para abrir modal de edição de inadimplente
async function openEditUnpaidModal(id) {
    if (!supabaseClient) return;

    try {
        const { data: inadimplente, error } = await supabaseClient
            .from('inadimplentes')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        // Abrir modal
        openAddUnpaidModal();

        // Mudar título (opcional, visual)
        const modalTitle = document.querySelector('#addUnpaidModal .modal-header h4');
        if (modalTitle) modalTitle.textContent = 'Editar Inadimplência';

        // Mudar botão de submit (opcional, visual)
        const submitBtn = document.querySelector('#addUnpaidModal button[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Salvar Alterações';

        // Preencher dados
        document.getElementById('editUnpaidId').value = inadimplente.id;

        // Selecionar tipo de inadimplência (geralmente independente se estamos editando dados brutos)
        const independentRadio = document.querySelector('input[name="unpaidType"][value="independent"]');
        if (independentRadio) {
            independentRadio.checked = true;
            toggleUnpaidType();
        }

        document.getElementById('addUnpaidNome').value = inadimplente.nome_cliente || '';
        document.getElementById('addUnpaidTelefone').value = inadimplente.telefone || '';
        document.getElementById('addUnpaidServico').value = inadimplente.servico || '';
        document.getElementById('addUnpaidData').value = inadimplente.data_vencimento || '';
        document.getElementById('addUnpaidValor').value = inadimplente.valor_devido || '';
        document.getElementById('addUnpaidObservacoes').value = inadimplente.observacoes_cobranca || '';

    } catch (error) {
        console.error('Erro ao carregar inadimplente:', error);
        showNotification('Erro ao carregar dados: ' + error.message, 'error');
    }
}

// Função para excluir inadimplente
async function deleteUnpaidClient(id) {
    if (!confirm('Tem certeza que deseja excluir este registro de inadimplência?')) {
        return;
    }

    if (!supabaseClient) return;

    try {
        const { error } = await supabaseClient
            .from('inadimplentes')
            .delete()
            .eq('id', id);

        if (error) throw error;

        showNotification('Registro excluído com sucesso!', 'success');
        loadUnpaidClients();
    } catch (error) {
        console.error('Erro ao excluir inadimplente:', error);
        showNotification('Erro ao excluir: ' + error.message, 'error');
    }
}

// Função para atualizar resumo de inadimplentes
function updateUnpaidSummary(unpaidClients) {
    const totalClients = unpaidClients.length;
    // Usar valor_devido se disponível, senão usar preco_cobrado
    const totalAmount = unpaidClients.reduce((sum, client) => {
        const valor = client.valor_devido || client.preco_cobrado || 0;
        return sum + parseFloat(valor);
    }, 0);

    document.getElementById('totalUnpaidClients').textContent = totalClients;
    document.getElementById('totalUnpaidAmount').textContent = `R$ ${totalAmount.toFixed(2)}`;

    // Remover a seção "Mais Antigo" - não é mais necessária
    const oldestElement = document.getElementById('oldestUnpaid');
    if (oldestElement) {
        oldestElement.textContent = '-';
    }
}

// Função para marcar como pago
async function markAsPaid(appointmentId) {
    if (!confirm('Confirma que este pagamento foi realizado?')) {
        return;
    }

    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    try {
        // Buscar o valor devido antes de atualizar
        const { data: inadimplente } = await supabaseClient
            .from('inadimplentes')
            .select('valor_devido')
            .eq('agendamento_id', appointmentId)
            .single();

        // Atualizar status do inadimplente para quitado
        const { error: inadimplenteError } = await supabaseClient
            .from('inadimplentes')
            .update({
                status_cobranca: 'quitado',
                valor_pago: inadimplente?.valor_devido || 0
            })
            .eq('agendamento_id', appointmentId);

        if (inadimplenteError) throw inadimplenteError;

        // Criar registro de pagamento
        const { data: agendamento } = await supabaseClient
            .from('agendamentos')
            .select('preco_cobrado')
            .eq('id', appointmentId)
            .single();

        if (agendamento) {
            await supabaseClient
                .from('pagamentos')
                .insert({
                    agendamento_id: appointmentId,
                    valor_pago: agendamento.preco_cobrado,
                    forma_pagamento: 'dinheiro',
                    status_pagamento: 'aprovado',
                    data_pagamento: new Date().toISOString()
                });
        }

        showNotification('Pagamento marcado como realizado!', 'success');
        loadUnpaidClients(); // Recarregar lista

    } catch (error) {
        console.error('Erro ao marcar como pago:', error);
        showNotification('Erro ao atualizar pagamento: ' + error.message, 'error');
    }
}

// Nova função para marcar como pago usando o ID da inadimplência (suporta inadimplência independente)
// Agora abre modal para selecionar forma de pagamento
let currentInadimplenteData = null;

async function markAsPaidByInadimplente(inadimplenteId) {
    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    try {
        // Buscar dados da inadimplência para exibir no modal
        // Não fazemos join com clientes para evitar erros de coluna
        const { data: inadimplente, error: fetchError } = await supabaseClient
            .from('inadimplentes')
            .select('*, agendamentos(servico, preco_cobrado, nome_cliente)')
            .eq('id', inadimplenteId)
            .single();

        if (fetchError) throw fetchError;

        // Guardar dados para usar na confirmação
        currentInadimplenteData = inadimplente;

        // Preencher modal com informações
        document.getElementById('inadimplentePaymentId').value = inadimplenteId;

        // Usar nome do cliente de diferentes fontes possíveis
        const clienteNome = inadimplente.cliente_nome ||
            inadimplente.agendamentos?.nome_cliente ||
            'Cliente';
        const servico = inadimplente.agendamentos?.servico || inadimplente.servico || 'Serviço';
        const valor = parseFloat(inadimplente.valor_devido) || 0;

        document.getElementById('inadimplentePaymentInfo').innerHTML = `
            <div class="info-row"><strong>Cliente:</strong> ${clienteNome}</div>
            <div class="info-row"><strong>Serviço:</strong> ${servico}</div>
            <div class="info-row"><strong>Valor:</strong> <span class="highlight">R$ ${valor.toFixed(2)}</span></div>
        `;

        // Reset para dinheiro e atualizar resumo
        document.getElementById('inadimplentePaymentMethod').value = 'dinheiro';
        updateInadimplentePaymentSummary();

        // Abrir modal
        document.getElementById('inadimplentePaymentModal').style.display = 'flex';

    } catch (error) {
        console.error('Erro ao carregar dados do inadimplente:', error);
        showNotification('Erro ao carregar dados: ' + error.message, 'error');
    }
}

function closeInadimplentePaymentModal() {
    document.getElementById('inadimplentePaymentModal').style.display = 'none';
    currentInadimplenteData = null;
}

function updateInadimplentePaymentSummary() {
    if (!currentInadimplenteData) return;

    const method = document.getElementById('inadimplentePaymentMethod').value;
    const valor = parseFloat(currentInadimplenteData.valor_devido) || 0;
    const taxaPercent = PAYMENT_FEES[method] || 0;
    const valorLiquido = calculateNetValue(valor, method);
    const taxaValor = valor - valorLiquido;

    const summaryEl = document.getElementById('inadimplentePaymentSummary');
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

async function confirmInadimplentePayment() {
    if (!currentInadimplenteData) {
        showNotification('Erro: dados não encontrados', 'error');
        return;
    }

    const inadimplenteId = parseInt(document.getElementById('inadimplentePaymentId').value);
    const paymentMethod = document.getElementById('inadimplentePaymentMethod').value;
    const valor = parseFloat(currentInadimplenteData.valor_devido) || 0;
    const valorLiquido = calculateNetValue(valor, paymentMethod);

    try {
        // Atualizar status do inadimplente para quitado
        const { error: inadimplenteError } = await supabaseClient
            .from('inadimplentes')
            .update({
                status_cobranca: 'quitado',
                valor_pago: valor,
                valor_restante: 0
            })
            .eq('id', inadimplenteId);

        if (inadimplenteError) throw inadimplenteError;

        // Se tiver agendamento vinculado, atualizar status_pagamento
        if (currentInadimplenteData.agendamento_id) {
            const { error: agendamentoError } = await supabaseClient
                .from('agendamentos')
                .update({
                    status_pagamento: 'pago',
                    forma_pagamento: paymentMethod,
                    valor_pago: valor,
                    valor_liquido: valorLiquido,
                    taxa_aplicada: PAYMENT_FEES[paymentMethod] || 0
                })
                .eq('id', currentInadimplenteData.agendamento_id);

            if (agendamentoError) {
                console.error('Erro ao atualizar agendamento:', agendamentoError);
            }

            // Criar registro de pagamento
            await supabaseClient
                .from('pagamentos')
                .insert({
                    agendamento_id: currentInadimplenteData.agendamento_id,
                    cliente_id: currentInadimplenteData.cliente_id,
                    valor_pago: valor,
                    forma_pagamento: paymentMethod,
                    status: 'pago',
                    data_pagamento: new Date().toISOString()
                });

            // Registrar log de auditoria
            await supabaseClient
                .from('logs_sistema')
                .insert([{
                    tipo: 'INADIMPLENTE_QUITADO',
                    origem: 'sistema',
                    mensagem: `Inadimplência quitada via ${paymentMethod} - R$ ${valor.toFixed(2)}`,
                    detalhes: {
                        inadimplente_id: inadimplenteId,
                        agendamento_id: currentInadimplenteData.agendamento_id,
                        cliente_id: currentInadimplenteData.cliente_id,
                        valor: valor,
                        valor_liquido: valorLiquido,
                        forma_pagamento: paymentMethod,
                        data_quitacao: new Date().toISOString()
                    }
                }]);
        }

        closeInadimplentePaymentModal();
        showNotification('Pagamento confirmado com sucesso!', 'success');
        loadUnpaidClients();
        loadAppointments();
        loadTodayAppointments();
        loadOverviewData();

    } catch (error) {
        console.error('Erro ao confirmar pagamento:', error);
        showNotification('Erro ao confirmar pagamento: ' + error.message, 'error');
    }
}

// Função para contatar cliente
async function contactClient(phone, name, appointmentId) {
    const normalizedPhone = normalizePhone(phone);
    const message = `Olá ${name}! Esperamos que esteja bem. Gostaríamos de lembrar sobre o pagamento pendente do seu último atendimento na Barbearia. Agradecemos a compreensão!`;
    const whatsappUrl = `https://wa.me/55${normalizedPhone}?text=${encodeURIComponent(message)}`;

    // Registrar o contato no banco se estiver usando Supabase
    if (supabaseClient && appointmentId) {
        try {
            // Buscar tentativas atuais antes de incrementar
            const { data: inadimplente } = await supabaseClient
                .from('inadimplentes')
                .select('tentativas_contato')
                .eq('agendamento_id', appointmentId)
                .single();

            await supabaseClient
                .from('inadimplentes')
                .update({
                    tentativas_contato: (inadimplente?.tentativas_contato || 0) + 1,
                    ultimo_contato: new Date().toISOString()
                })
                .eq('agendamento_id', appointmentId);
        } catch (error) {
            console.error('Erro ao registrar contato:', error);
        }
    }

    window.open(whatsappUrl, '_blank');
}

// ==================== ATUALIZAÇÃO DOS MODAIS COM FORMA DE PAGAMENTO ====================

// ==================== FUNÇÃO PARA VERIFICAR CONFLITOS DE HORÁRIO ====================

// Função simplificada removida - usar checkTimeConflictSupabase

// ==================== MODAL ADICIONAR INADIMPLENTE ====================

// Função para abrir modal de adicionar inadimplente
function openAddUnpaidModal() {
    const modal = document.getElementById('addUnpaidModal');

    if (!modal) {
        console.error('Modal addUnpaidModal não encontrado!');
        showNotification('Erro: Modal não encontrado', 'error');
        return;
    }

    modal.style.display = 'block';

    // Definir data padrão como hoje
    const today = new Date().toISOString().split('T')[0];
    const dataField = document.getElementById('addUnpaidData');

    if (dataField) {
        dataField.value = today;
    }

    // Limpar formulário
    const form = document.getElementById('addUnpaidForm');
    if (form) {
        form.reset();
        if (dataField) {
            dataField.value = today;
        }
    }
}

// Função para fechar modal de adicionar inadimplente
function closeAddUnpaidModal() {
    const modal = document.getElementById('addUnpaidModal');
    modal.style.display = 'none';

    // Limpar formulário
    document.getElementById('addUnpaidForm').reset();
    document.getElementById('editUnpaidId').value = ''; // Limpar ID de edição

    // Restaurar título e botão
    const modalTitle = document.querySelector('#addUnpaidModal .modal-header h4');
    if (modalTitle) modalTitle.textContent = 'Adicionar Cliente Inadimplente';
    const submitBtn = document.querySelector('#addUnpaidModal button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Adicionar';
}

// Função para atualizar preço do serviço no modal de inadimplente
function updateUnpaidServicePrice() {
    const servicoSelect = document.getElementById('addUnpaidServico');
    const precoInput = document.getElementById('addUnpaidValor');

    // Limpar o campo de preço para que o barbeiro defina o valor
    if (servicoSelect.value) {
        precoInput.value = '';
        precoInput.focus();
    }
}

// Função para alternar tipo de inadimplência
function toggleUnpaidType() {
    const appointmentRadio = document.querySelector('input[name="unpaidType"][value="appointment"]');
    const appointmentSelection = document.getElementById('appointmentSelection');
    const clientFields = document.querySelectorAll('#addUnpaidNome, #addUnpaidTelefone, #addUnpaidServico, #addUnpaidData, #addUnpaidValor');

    if (appointmentRadio.checked) {
        appointmentSelection.style.display = 'block';
        loadPendingAppointments();
        // Desabilitar campos que serão preenchidos automaticamente
        clientFields.forEach(field => field.disabled = true);
    } else {
        appointmentSelection.style.display = 'none';
        // Habilitar campos para preenchimento manual
        clientFields.forEach(field => field.disabled = false);
        clearUnpaidForm();
    }
}

// Função para carregar agendamentos para correlacionar com inadimplentes
async function loadPendingAppointments() {
    if (!isSupabaseConfigured) {
        console.warn('⚠️ Supabase não configurado');
        return;
    }

    try {
        // Primeiro, buscar IDs de agendamentos que já são inadimplentes
        const { data: inadimplentes, error: inadError } = await supabaseClient
            .from('inadimplentes')
            .select('agendamento_id');

        if (inadError) {
            console.warn('Erro ao buscar inadimplentes:', inadError);
        }

        const idsInadimplentes = inadimplentes ? inadimplentes.map(i => i.agendamento_id) : [];

        // Buscar agendamentos
        const { data: appointments, error } = await supabaseClient
            .from('agendamentos')
            .select(`
                id,
                data_horario,
                horario_inicio,
                horario_fim,
                preco,
                status,
                nome_cliente,
                telefone,
                servico,
                clientes(nome, telefone),
                servicos(nome, preco_base)
            `)
            .order('data_horario', { ascending: false })
            .order('horario_inicio', { ascending: true });

        if (error) throw error;

        const select = document.getElementById('addUnpaidAppointment');
        select.innerHTML = '<option value="">Selecione um agendamento</option>';

        // Filtrar agendamentos que já são inadimplentes
        const availableAppointments = appointments.filter(apt => !idsInadimplentes.includes(apt.id));

        if (availableAppointments.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Nenhum agendamento disponível';
            option.disabled = true;
            select.appendChild(option);
            return;
        }

        availableAppointments.forEach(appointment => {
            const option = document.createElement('option');
            option.value = appointment.id;
            const dataFormatada = formatDate(appointment.data_horario.split('T')[0]);
            const statusText = appointment.status ? ` (${appointment.status})` : '';
            // Usar campos diretos ou da relação
            const clienteNome = appointment.clientes?.nome || appointment.nome_cliente || 'Cliente';
            const servicoNome = appointment.servicos?.nome || appointment.servico || 'Serviço';
            option.textContent = `${clienteNome} - ${servicoNome} - ${dataFormatada} ${appointment.horario_inicio}-${appointment.horario_fim}${statusText}`;
            option.dataset.appointment = JSON.stringify(appointment);
            select.appendChild(option);
        });

    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
        showNotification('Erro ao carregar agendamentos', 'error');
    }
}

// Função para verificar e atualizar status de agendamentos vencidos
async function checkAndUpdateExpiredAppointments() {
    if (!isSupabaseConfigured) {
        return;
    }

    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const currentTime = now.toTimeString().slice(0, 5); // HH:MM

        // Buscar agendamentos que já passaram do horário
        const { data: expiredAppointments, error } = await supabaseClient
            .from('agendamentos')
            .select('id, data_horario, horario_inicio, horario_fim')
            .in('status', ['agendado', 'confirmado'])
            .lt('data_horario', now.toISOString());

        if (error) {
            return;
        }

        if (!expiredAppointments || expiredAppointments.length === 0) {
            return;
        }

        const appointmentsToUpdate = [];

        expiredAppointments.forEach(appointment => {
            const appointmentDateTime = new Date(appointment.data_horario);
            const appointmentEndTime = appointment.horario_fim;

            // Criar data/hora de fim do agendamento
            const [hours, minutes] = appointmentEndTime.split(':');
            const appointmentEndDateTime = new Date(appointmentDateTime);
            appointmentEndDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

            // Se já passou do horário de fim, marcar para atualização
            if (now > appointmentEndDateTime) {
                appointmentsToUpdate.push(appointment.id);
            }
        });

        if (appointmentsToUpdate.length > 0) {
            const { error: updateError } = await supabaseClient
                .from('agendamentos')
                .update({ status: 'concluido' })
                .in('id', appointmentsToUpdate);

            if (!updateError) {
                // Recarregar a lista de agendamentos se estiver na página relevante
                if (typeof loadAppointments === 'function') {
                    loadAppointments();
                }
                if (typeof loadTodayAppointments === 'function') {
                    loadTodayAppointments();
                }
            }
        }
    } catch (error) {
        console.error('Erro na verificação automática de agendamentos:', error);
    }
}

// Inicializar verificação automática de agendamentos vencidos
function initializeAppointmentStatusChecker() {
    // Verificar imediatamente
    checkAndUpdateExpiredAppointments();

    // Verificar a cada 5 minutos (300000 ms)
    setInterval(checkAndUpdateExpiredAppointments, 300000);
}

// Função para preencher formulário com dados do agendamento
function fillFromAppointment() {
    const select = document.getElementById('addUnpaidAppointment');
    const selectedOption = select.options[select.selectedIndex];

    if (selectedOption.value && selectedOption.dataset.appointment) {
        const appointment = JSON.parse(selectedOption.dataset.appointment);

        document.getElementById('addUnpaidNome').value = appointment.clientes.nome;
        document.getElementById('addUnpaidTelefone').value = appointment.clientes.telefone;
        document.getElementById('addUnpaidServico').value = appointment.servicos.nome;
        document.getElementById('addUnpaidData').value = appointment.data_horario.split('T')[0];
        document.getElementById('addUnpaidValor').value = (appointment.preco || appointment.preco_cobrado) || appointment.servicos?.preco_base || '';
    }
}

// Função para limpar formulário de inadimplentes
function clearUnpaidForm() {
    document.getElementById('addUnpaidNome').value = '';
    document.getElementById('addUnpaidTelefone').value = '';
    document.getElementById('addUnpaidServico').value = '';
    document.getElementById('addUnpaidData').value = '';
    document.getElementById('addUnpaidValor').value = '';
    document.getElementById('addUnpaidObservacoes').value = '';
}

// Função para adicionar cliente inadimplente
async function addUnpaidClient(event) {
    event.preventDefault();

    // Verificar tipo de inadimplência
    const unpaidType = document.querySelector('input[name="unpaidType"]:checked').value;
    const isAppointmentBased = unpaidType === 'appointment';

    let appointmentId = null;
    let clienteNome, clienteTelefone, servico, dataServico, valorDevido;
    const observacoes = document.getElementById('addUnpaidObservacoes').value.trim();
    const editId = document.getElementById('editUnpaidId')?.value; // ID para edição

    if (isAppointmentBased) {
        // Inadimplência baseada em agendamento
        appointmentId = document.getElementById('addUnpaidAppointment').value;
        if (!appointmentId) {
            showNotification('Por favor, selecione um agendamento.', 'warning');
            return;
        }

        // Obter dados do agendamento selecionado
        const select = document.getElementById('addUnpaidAppointment');
        const selectedOption = select.options[select.selectedIndex];

        if (!selectedOption || !selectedOption.dataset.appointment) {
            showNotification('Dados do agendamento não encontrados.', 'error');
            return;
        }

        const appointment = JSON.parse(selectedOption.dataset.appointment);

        clienteNome = appointment.clientes?.nome || appointment.nome_cliente || '';
        clienteTelefone = appointment.clientes?.telefone || appointment.telefone || '';
        servico = appointment.servicos?.nome || appointment.servico || '';
        dataServico = appointment.data_horario ? appointment.data_horario.split('T')[0] : '';
        valorDevido = parseFloat(appointment.preco || appointment.servicos?.preco_base || 0) || 0;

        if (!clienteNome || !clienteTelefone || !servico || !dataServico || valorDevido <= 0) {
            showNotification('Dados do agendamento incompletos. Use inadimplência independente.', 'warning');
            return;
        }
    } else {
        // Inadimplência independente
        clienteNome = document.getElementById('addUnpaidNome').value.trim();
        clienteTelefone = document.getElementById('addUnpaidTelefone').value.trim();
        servico = document.getElementById('addUnpaidServico').value;
        dataServico = document.getElementById('addUnpaidData').value;
        valorDevido = parseFloat(document.getElementById('addUnpaidValor').value) || 0;
    }

    // Validações
    if (!clienteNome || !clienteTelefone || !servico || !dataServico || valorDevido <= 0) {
        showNotification('Por favor, preencha todos os campos obrigatórios.', 'warning');
        return;
    }

    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    try {
        showLoading();

        // Se for edição, pular verificação de cliente (assumimos que dados estão ok ou apenas atualizamos inadimplentes)
        // Mas se for criar novo, precisamos do clienteId

        let clienteId;
        const telefoneNormalizado = normalizePhone(clienteTelefone);

        // Se tivermos editId, apenas atualizamos a tabela inadimplentes
        if (editId) {
            const updateData = {
                nome_cliente: clienteNome,
                telefone: telefoneNormalizado,
                servico: servico,
                data_vencimento: dataServico,
                valor_devido: parseFloat(valorDevido),
                valor_restante: parseFloat(valorDevido), // Reseta o restante para o valor total na edição simples
                observacoes_cobranca: observacoes || null
            };

            const { error: updateError } = await supabaseClient
                .from('inadimplentes')
                .update(updateData)
                .eq('id', editId);

            if (updateError) throw updateError;

            showNotification('Inadimplência atualizada com sucesso!', 'success');
            closeAddUnpaidModal();
            loadUnpaidClients();
            return;
        }

        // Primeiro, verificar se o cliente já existe ou criar um novo
        // Variáveis já declaradas acima

        // Buscar cliente existente pelo telefone normalizado
        const { data: clienteExistente, error: searchError } = await supabaseClient
            .from('clientes')
            .select('id')
            .eq('telefone_normalizado', telefoneNormalizado)
            .single();

        if (searchError && searchError.code !== 'PGRST116') {
            console.error('Erro ao buscar cliente:', searchError);
        }

        if (clienteExistente) {
            clienteId = parseInt(clienteExistente.id);
        } else {
            // Criar novo cliente
            const { data: novoCliente, error: clienteError } = await supabaseClient
                .from('clientes')
                .insert([{
                    nome: clienteNome,
                    telefone: clienteTelefone,
                    telefone_normalizado: telefoneNormalizado,
                    status_cliente: 'ativo'
                }])
                .select('id')
                .single();

            if (clienteError) {
                throw clienteError;
            }
            clienteId = parseInt(novoCliente.id);
        }

        let agendamentoId;

        if (isAppointmentBased) {
            // Inadimplência baseada em agendamento existente
            agendamentoId = parseInt(appointmentId);

            // Atualizar status do agendamento para 'concluido' (serviço realizado mas não pago)
            const { error: updateError } = await supabaseClient
                .from('agendamentos')
                .update({ status: 'concluido' })
                .eq('id', agendamentoId);

            if (updateError) {
                throw updateError;
            }

        } else {
            // Inadimplência independente - NÃO criar agendamento fantasma
            // Apenas inserir diretamente na tabela inadimplentes
            agendamentoId = null; // Sem agendamento associado
        }

        // Adicionar na tabela de inadimplentes
        const inadimplente = {
            agendamento_id: agendamentoId, // Pode ser null para inadimplência independente
            cliente_id: parseInt(clienteId),
            telefone: telefoneNormalizado,
            nome_cliente: clienteNome,
            servico: servico,
            valor_devido: parseFloat(valorDevido),
            valor_pago: 0.00,
            valor_restante: parseFloat(valorDevido),
            data_vencimento: dataServico,
            observacoes_cobranca: observacoes || null
        };

        const { error: inadimplenteError } = await supabaseClient
            .from('inadimplentes')
            .insert([inadimplente]);

        if (inadimplenteError) {
            throw inadimplenteError;
        }

        showNotification('Cliente inadimplente adicionado com sucesso!', 'success');
        closeAddUnpaidModal();
        loadUnpaidClients(); // Recarregar lista

    } catch (error) {
        console.error('Erro ao adicionar inadimplente:', error);
        showNotification('Erro ao adicionar inadimplente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ==================== GERENCIAMENTO DE CLIENTES ====================

// Função para carregar clientes
async function loadClients() {
    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    try {
        showLoading();

        const searchTerm = document.getElementById('clientSearch')?.value?.trim() || '';

        let query = supabaseClient
            .from('clientes')
            .select('*')
            .order('criado_em', { ascending: false });

        // Aplicar filtro de busca se houver
        if (searchTerm) {
            query = query.or(`nome.ilike.%${searchTerm}%,telefone.ilike.%${searchTerm}%`);
        }

        const { data: clients, error } = await query;

        if (error) throw error;

        // Buscar estatísticas de agendamentos para cada cliente
        const clientsWithStats = await Promise.all((clients || []).map(async (client) => {
            const { data: agendamentos } = await supabaseClient
                .from('agendamentos')
                .select('data_horario')
                .eq('cliente_id', client.id)
                .order('data_horario', { ascending: false });

            return {
                ...client,
                totalAgendamentos: agendamentos?.length || 0,
                ultimoAgendamento: agendamentos?.[0]?.data_horario || null
            };
        }));

        renderClientsTable(clientsWithStats);

    } catch (error) {
        console.error('Erro ao carregar clientes:', error);
        showNotification('Erro ao carregar clientes: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Função para busca em tempo real
function setupClientSearch() {
    const searchInput = document.getElementById('clientSearch');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadClients();
            }, 500); // Aguarda 500ms após parar de digitar
        });
    }
}

// Função para renderizar tabela de clientes
function renderClientsTable(clients) {
    const tableBody = document.querySelector('#clientsTableBody');

    if (!tableBody) {
        console.error('Tabela de clientes não encontrada');
        return;
    }

    tableBody.innerHTML = '';

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

    clients.forEach(client => {
        const totalAgendamentos = client.totalAgendamentos || 0;
        const ultimoAgendamentoFormatado = client.ultimoAgendamento ?
            formatDate(client.ultimoAgendamento) : 'Nunca';

        const statusClass = client.status_cliente === 'ativo' ? 'status-active' :
            client.status_cliente === 'inativo' ? 'status-inactive' : 'status-blocked';

        // Formatar telefone para exibição padronizada
        const telefoneFormatado = formatPhoneDisplay(client.telefone);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${client.nome}</td>
            <td>${telefoneFormatado}</td>
            <td><span class="status-badge ${statusClass}">${client.status_cliente || 'ativo'}</span></td>
            <td>${totalAgendamentos}</td>
            <td>${ultimoAgendamentoFormatado}</td>
            <td>${formatDate(client.criado_em)}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-edit" onclick="openEditClientModal(${client.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-delete" onclick="deleteClient(${client.id}, '${client.nome}')" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                    <button class="btn-contact" onclick="contactClientDirect('${client.telefone}', '${client.nome}')" title="Contatar">
                        <i class="fab fa-whatsapp"></i>
                    </button>
                </div>
            </td>
        `;

        tableBody.appendChild(row);
    });
}

// Função para abrir modal de adicionar cliente
function openAddClientModal() {
    const modal = document.getElementById('addClientModal');
    modal.style.display = 'block';

    // Limpar formulário
    document.getElementById('addClientForm').reset();
    document.getElementById('addClientStatus').value = 'ativo';

    // Limpar campos de telefone segmentados
    const dddField = document.getElementById('addClientDDD');
    const numeroField = document.getElementById('addClientNumero');
    if (dddField) dddField.value = '';
    if (numeroField) numeroField.value = '';
}

// Função para fechar modal de adicionar cliente
function closeAddClientModal() {
    const modal = document.getElementById('addClientModal');
    modal.style.display = 'none';

    // Limpar formulário
    document.getElementById('addClientForm').reset();

    // Limpar campos de telefone segmentados
    const dddField = document.getElementById('addClientDDD');
    const numeroField = document.getElementById('addClientNumero');
    if (dddField) dddField.value = '';
    if (numeroField) numeroField.value = '';
}

// Função para adicionar cliente
async function addClient(event) {
    event.preventDefault();

    const nome = document.getElementById('addClientNome').value.trim();
    const ddd = document.getElementById('addClientDDD')?.value.trim() || '';
    const numero = document.getElementById('addClientNumero')?.value.replace(/\D/g, '') || '';
    const email = document.getElementById('addClientEmail').value.trim();
    const dataNascimento = document.getElementById('addClientDataNascimento').value;
    const status = document.getElementById('addClientStatus').value;
    const observacoes = document.getElementById('addClientObservacoes').value.trim();

    // Validações
    if (!nome) {
        showNotification('Nome é obrigatório.', 'warning');
        document.getElementById('addClientNome').focus();
        return;
    }

    if (!ddd || ddd.length !== 2) {
        showNotification('Por favor, preencha o DDD (2 dígitos).', 'warning');
        document.getElementById('addClientDDD')?.focus();
        return;
    }

    if (!numero || numero.length < 8) {
        showNotification('Por favor, preencha o número do telefone (8 dígitos).', 'warning');
        document.getElementById('addClientNumero')?.focus();
        return;
    }

    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    // Montar telefone completo
    const telefoneCompleto = `55 ${ddd} 9${numero.substring(0, 4)}-${numero.substring(4, 8)}`;

    try {
        showLoading();

        const telefoneNormalizado = normalizePhone(telefoneCompleto);

        // Verificar se já existe cliente com este telefone
        const { data: existingClient } = await supabaseClient
            .from('clientes')
            .select('id')
            .eq('telefone', telefoneNormalizado)
            .single();

        if (existingClient) {
            showNotification('Já existe um cliente cadastrado com este telefone.', 'warning');
            return;
        }

        // Criar novo cliente
        const clienteData = {
            nome: nome,
            telefone: telefoneNormalizado,
            email: email || null,
            data_nascimento: dataNascimento || null,
            status_cliente: status,
            observacoes: observacoes || null
        };

        const { error } = await supabaseClient
            .from('clientes')
            .insert([clienteData]);

        if (error) throw error;

        showNotification('Cliente adicionado com sucesso!', 'success');
        closeAddClientModal();
        loadClients(); // Recarregar lista

    } catch (error) {
        console.error('Erro ao adicionar cliente:', error);
        showNotification('Erro ao adicionar cliente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Função para abrir modal de editar cliente
async function openEditClientModal(clientId) {
    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    try {
        showLoading();

        const { data: client, error } = await supabaseClient
            .from('clientes')
            .select('*')
            .eq('id', clientId)
            .single();

        if (error) throw error;

        // Preencher formulário
        document.getElementById('editClientId').value = client.id;
        document.getElementById('editClientNome').value = client.nome;
        document.getElementById('editClientTelefone').value = client.telefone;
        document.getElementById('editClientEmail').value = client.email || '';
        document.getElementById('editClientDataNascimento').value = client.data_nascimento || '';
        document.getElementById('editClientStatus').value = client.status_cliente;
        document.getElementById('editClientObservacoes').value = client.observacoes || '';

        // Desmembrar telefone nos campos segmentados
        desmembrarTelefone(client.telefone, 'editClientDDD', 'editClientNumero');

        // Abrir modal
        const modal = document.getElementById('editClientModal');
        modal.style.display = 'block';

    } catch (error) {
        console.error('Erro ao carregar dados do cliente:', error);
        showNotification('Erro ao carregar dados do cliente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Função para fechar modal de editar cliente
function closeEditClientModal() {
    const modal = document.getElementById('editClientModal');
    modal.style.display = 'none';

    // Limpar formulário
    document.getElementById('editClientForm').reset();
}

// Função para atualizar cliente
async function updateClient(event) {
    event.preventDefault();

    const clientId = document.getElementById('editClientId').value;
    const nome = document.getElementById('editClientNome').value.trim();
    const ddd = document.getElementById('editClientDDD')?.value.trim() || '';
    const numero = document.getElementById('editClientNumero')?.value.replace(/\D/g, '') || '';
    const email = document.getElementById('editClientEmail').value.trim();
    const dataNascimento = document.getElementById('editClientDataNascimento').value;
    const status = document.getElementById('editClientStatus').value;
    const observacoes = document.getElementById('editClientObservacoes').value.trim();

    // Validações
    if (!nome) {
        showNotification('Nome é obrigatório.', 'warning');
        document.getElementById('editClientNome').focus();
        return;
    }

    if (!ddd || ddd.length !== 2) {
        showNotification('Por favor, preencha o DDD (2 dígitos).', 'warning');
        document.getElementById('editClientDDD')?.focus();
        return;
    }

    if (!numero || numero.length < 8) {
        showNotification('Por favor, preencha o número do telefone (8 dígitos).', 'warning');
        document.getElementById('editClientNumero')?.focus();
        return;
    }

    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    // Montar telefone completo
    const telefoneCompleto = `55 ${ddd} 9${numero.substring(0, 4)}-${numero.substring(4, 8)}`;

    try {
        showLoading();

        const telefoneNormalizado = normalizePhone(telefoneCompleto);

        // Verificar se já existe outro cliente com este telefone
        const { data: existingClient } = await supabaseClient
            .from('clientes')
            .select('id')
            .eq('telefone', telefoneNormalizado)
            .neq('id', clientId)
            .single();

        if (existingClient) {
            showNotification('Já existe outro cliente cadastrado com este telefone.', 'warning');
            return;
        }

        // Atualizar cliente
        const clienteData = {
            nome: nome,
            telefone: telefoneNormalizado,
            email: email || null,
            data_nascimento: dataNascimento || null,
            status_cliente: status,
            observacoes: observacoes || null
        };

        const { error } = await supabaseClient
            .from('clientes')
            .update(clienteData)
            .eq('id', clientId);

        if (error) throw error;

        showNotification('Cliente atualizado com sucesso!', 'success');
        closeEditClientModal();
        loadClients(); // Recarregar lista

    } catch (error) {
        console.error('Erro ao atualizar cliente:', error);
        showNotification('Erro ao atualizar cliente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Função para excluir cliente
async function deleteClient(clientId, clientName) {
    if (!confirm(`Tem certeza que deseja excluir o cliente "${clientName}"?\n\nEsta ação não pode ser desfeita.`)) {
        return;
    }

    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    try {
        showLoading();

        // Verificar se o cliente tem agendamentos
        const { data: appointments, error: appointmentsError } = await supabaseClient
            .from('agendamentos')
            .select('id')
            .eq('cliente_id', clientId)
            .limit(1);

        if (appointmentsError) throw appointmentsError;

        if (appointments && appointments.length > 0) {
            showNotification('Não é possível excluir este cliente pois ele possui agendamentos.', 'warning');
            return;
        }

        // Excluir cliente
        const { error } = await supabaseClient
            .from('clientes')
            .delete()
            .eq('id', clientId);

        if (error) throw error;

        showNotification('Cliente excluído com sucesso!', 'success');
        loadClients(); // Recarregar lista

    } catch (error) {
        console.error('Erro ao excluir cliente:', error);
        showNotification('Erro ao excluir cliente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Função para contatar cliente diretamente
function contactClientDirect(phone, name) {
    const normalizedPhone = normalizePhone(phone);
    const message = `Olá ${name}! Como está? Aqui é da Barbearia do Jão. Esperamos vê-lo em breve!`;
    const whatsappUrl = `https://wa.me/55${normalizedPhone}?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
}

// ==================== MODAL RÁPIDO DE CLIENTE ====================

let currentQuickClientContext = null; // 'add', 'edit', 'unpaid'

// Função para abrir modal rápido de cliente
function openQuickClientModal(context) {
    currentQuickClientContext = context;
    const modal = document.getElementById('quickClientModal');
    modal.style.display = 'block';

    // Limpar formulário
    document.getElementById('quickClientForm').reset();

    // Focar no campo nome
    setTimeout(() => {
        document.getElementById('quickClientNome').focus();
    }, 100);
}

// Função para fechar modal rápido de cliente
function closeQuickClientModal() {
    const modal = document.getElementById('quickClientModal');
    modal.style.display = 'none';
    currentQuickClientContext = null;

    // Limpar formulário
    document.getElementById('quickClientForm').reset();
}

// Função para adicionar cliente rápido
async function addQuickClient(event) {
    event.preventDefault();

    const nome = document.getElementById('quickClientNome').value.trim();
    const telefone = document.getElementById('quickClientTelefone').value.trim();
    const email = document.getElementById('quickClientEmail').value.trim();

    // Validações
    if (!nome) {
        showNotification('O nome é obrigatório.', 'warning');
        return;
    }

    if (!supabaseClient) {
        showNotification('Funcionalidade disponível apenas com Supabase configurado', 'warning');
        return;
    }

    try {
        showLoading();

        let telefoneFormatado = null;
        let telefoneNormalizado = null;

        if (telefone) {
            telefoneNormalizado = normalizePhone(telefone);
            telefoneFormatado = formatarTelefone(telefone);

            // Verificar se já existe cliente com este telefone (busca pelo normalizado)
            const { data: existingClient } = await supabaseClient
                .from('clientes')
                .select('*')
                .eq('telefone_normalizado', telefoneNormalizado)
                .single();

            if (existingClient) {
                // Cliente já existe, usar o existente
                fillClientFields(existingClient);
                showNotification('Cliente já cadastrado! Dados preenchidos automaticamente.', 'info');

                // Marcar que o cliente foi selecionado (evitar duplicação)
                if (currentQuickClientContext === 'add') {
                    selectedAddClientId = existingClient.id;
                } else if (currentQuickClientContext === 'edit') {
                    selectedClientId = existingClient.id;
                } else if (currentQuickClientContext === 'retro') {
                    selectedRetroClientId = existingClient.id;
                }

                closeQuickClientModal();
                hideLoading();
                return;
            }
        }

        // Criar novo cliente (salva telefone formatado, o banco normaliza automaticamente se não nulo)
        const clienteData = {
            nome: nome,
            telefone: telefoneFormatado || null,
            email: email || null,
            status_cliente: 'ativo'
        };

        const { data: newClient, error } = await supabaseClient
            .from('clientes')
            .insert([clienteData])
            .select()
            .single();

        if (error) throw error;

        // Preencher campos com o novo cliente
        fillClientFields(newClient);
        showNotification('Cliente cadastrado e selecionado com sucesso!', 'success');

        // Atualizar lista de clientes em memória
        if (allClients) {
            allClients.push(newClient);
        }

        // Marcar que o cliente foi selecionado (evitar duplicação)
        if (currentQuickClientContext === 'add') {
            selectedAddClientId = newClient.id;
        } else if (currentQuickClientContext === 'edit') {
            selectedClientId = newClient.id;
        } else if (currentQuickClientContext === 'retro') {
            selectedRetroClientId = newClient.id;
        }

        closeQuickClientModal();

    } catch (error) {
        console.error('Erro ao processar cliente:', error);
        showNotification('Erro ao processar cliente: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Função para preencher campos do cliente baseado no contexto
function fillClientFields(client) {
    let nomeField, telefoneField, dddField, numeroField;

    switch (currentQuickClientContext) {
        case 'add':
            nomeField = document.getElementById('addNome');
            telefoneField = document.getElementById('addTelefone');
            dddField = document.getElementById('addDDD');
            numeroField = document.getElementById('addNumero');
            // Definir cliente selecionado para evitar duplicação
            selectedAddClientId = client.id;
            break;
        case 'edit':
            nomeField = document.getElementById('editNome');
            telefoneField = document.getElementById('editTelefone');
            dddField = document.getElementById('editDDD');
            numeroField = document.getElementById('editNumero');
            // Definir cliente selecionado para o autocomplete
            selectedClientId = client.id;
            break;
        case 'unpaid':
            nomeField = document.getElementById('addUnpaidNome');
            telefoneField = document.getElementById('addUnpaidTelefone');
            dddField = document.getElementById('addUnpaidDDD');
            numeroField = document.getElementById('addUnpaidNumero');
            break;
    }

    if (nomeField && telefoneField) {
        nomeField.value = client.nome;
        telefoneField.value = client.telefone;

        // Desmembrar telefone nos campos segmentados
        if (dddField && numeroField) {
            desmembrarTelefone(client.telefone, dddField.id, numeroField.id);
        }
    }
}

// ==================== AUTOCOMPLETE OTIMIZADO ====================

// Constantes de configuração do autocomplete
const AUTOCOMPLETE_DEBOUNCE_MS = 150;
const AUTOCOMPLETE_MAX_RESULTS = 10;
const AUTOCOMPLETE_MIN_CHARS = 2;

// Função para configurar autocomplete em todos os campos de cliente
function setupAllClientAutocomplete() {
    setupClientAutocompleteForField('addNome', 'addTelefone', 'addClientSuggestions');
    setupClientAutocompleteForField('editNome', 'editTelefone', 'clientSuggestions');
    setupClientAutocompleteForField('addUnpaidNome', 'addUnpaidTelefone', 'addUnpaidClientSuggestions');
}

// Função genérica otimizada para configurar autocomplete
function setupClientAutocompleteForField(inputId, phoneId, suggestionsId) {
    const clientInput = document.getElementById(inputId);
    const phoneInput = document.getElementById(phoneId);
    const suggestionsContainer = document.getElementById(suggestionsId);

    if (!clientInput || !suggestionsContainer) return;

    let selectedIndex = -1;
    let currentSelectedClientId = null;
    let debounceTimeout = null;
    let lastQuery = '';

    // Handler de input com debounce
    clientInput.addEventListener('input', function () {
        const query = this.value.trim().toLowerCase();

        // Limpar timeout anterior
        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }

        currentSelectedClientId = null;

        // Resetar cliente selecionado quando usuário digita
        if (inputId === 'addNome') {
            selectedAddClientId = null;
        } else if (inputId === 'editNome') {
            selectedClientId = null;
        }

        if (query.length < AUTOCOMPLETE_MIN_CHARS) {
            suggestionsContainer.style.display = 'none';
            lastQuery = '';
            return;
        }

        // Evitar busca se a query não mudou
        if (query === lastQuery) return;
        lastQuery = query;

        // Debounce da busca
        debounceTimeout = setTimeout(() => {
            performSearch(query);
        }, AUTOCOMPLETE_DEBOUNCE_MS);
    });

    // Função de busca otimizada
    function performSearch(query) {
        // Busca otimizada: primeiro por início do nome (mais relevante), depois por inclusão
        const startsWithMatches = [];
        const includesMatches = [];

        for (const client of allClients) {
            const nomeLower = (client.nome || '').toLowerCase();
            const telLower = (client.telefone || '').toLowerCase();

            if (nomeLower.startsWith(query)) {
                startsWithMatches.push(client);
            } else if (nomeLower.includes(query) || telLower.includes(query)) {
                includesMatches.push(client);
            }

            // Parar se já temos resultados suficientes
            if (startsWithMatches.length + includesMatches.length >= AUTOCOMPLETE_MAX_RESULTS * 2) {
                break;
            }
        }

        // Combinar resultados: primeiro os que começam, depois os que contêm
        const filteredClients = [...startsWithMatches, ...includesMatches].slice(0, AUTOCOMPLETE_MAX_RESULTS);

        if (filteredClients.length === 0) {
            suggestionsContainer.innerHTML = `
                <div class="client-suggestion no-results">
                    <span>Nenhum cliente encontrado</span>
                </div>
            `;
            suggestionsContainer.style.display = 'block';
            return;
        }

        // Renderizar sugestões com highlight
        suggestionsContainer.innerHTML = '';
        filteredClients.forEach((client, index) => {
            const suggestion = document.createElement('div');
            suggestion.className = 'client-suggestion';
            suggestion.dataset.clientId = client.id;

            // Highlight do texto que combina
            const highlightedName = highlightMatch(client.nome || '', query);
            const highlightedPhone = highlightMatch(client.telefone || '', query);

            suggestion.innerHTML = `
                <div class="client-suggestion-name">${highlightedName}</div>
                <div class="client-suggestion-phone">${highlightedPhone}</div>
            `;

            suggestion.addEventListener('click', () => {
                selectClientForField(client, inputId, phoneId, suggestionsId);
            });

            suggestionsContainer.appendChild(suggestion);
        });

        suggestionsContainer.style.display = 'block';
        selectedIndex = -1;
    }

    // Função para destacar o texto que combina
    function highlightMatch(text, query) {
        if (!text || !query) return text;
        const index = text.toLowerCase().indexOf(query);
        if (index === -1) return text;
        const before = text.substring(0, index);
        const match = text.substring(index, index + query.length);
        const after = text.substring(index + query.length);
        return `${before}<strong>${match}</strong>${after}`;
    }

    // Navegação com teclado
    clientInput.addEventListener('keydown', function (e) {
        const suggestions = suggestionsContainer.querySelectorAll('.client-suggestion:not(.no-results)');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
            updateSelectedSuggestion(suggestions);
            scrollToSelected(suggestions);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedSuggestion(suggestions);
            scrollToSelected(suggestions);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                const clientId = parseInt(suggestions[selectedIndex].dataset.clientId);
                const client = allClients.find(c => c.id === clientId);
                if (client) {
                    selectClientForField(client, inputId, phoneId, suggestionsId);
                }
            }
        } else if (e.key === 'Escape') {
            suggestionsContainer.style.display = 'none';
            selectedIndex = -1;
        }
    });

    // Fechar sugestões ao clicar fora
    document.addEventListener('click', function (e) {
        if (!clientInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
            suggestionsContainer.style.display = 'none';
            selectedIndex = -1;
        }
    });

    function updateSelectedSuggestion(suggestions) {
        suggestions.forEach((suggestion, index) => {
            suggestion.classList.toggle('selected', index === selectedIndex);
        });
    }

    function scrollToSelected(suggestions) {
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
            suggestions[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}

// Função para selecionar cliente em um campo específico
function selectClientForField(client, inputId, phoneId, suggestionsId) {
    const clientInput = document.getElementById(inputId);
    const phoneInput = document.getElementById(phoneId);
    const suggestionsContainer = document.getElementById(suggestionsId);

    clientInput.value = client.nome;
    if (phoneInput) {
        phoneInput.value = client.telefone;
    }

    // Desmembrar telefone nos campos segmentados
    if (inputId === 'addNome') {
        desmembrarTelefone(client.telefone, 'addDDD', 'addNumero');
    } else if (inputId === 'editNome') {
        desmembrarTelefone(client.telefone, 'editDDD', 'editNumero');
    } else if (inputId === 'addUnpaidNome') {
        desmembrarTelefone(client.telefone, 'addUnpaidDDD', 'addUnpaidNumero');
    }

    suggestionsContainer.style.display = 'none';

    // Definir cliente selecionado para contextos específicos
    if (inputId === 'addNome') {
        selectedAddClientId = client.id;
    } else if (inputId === 'editNome') {
        selectedClientId = client.id;
    }
}

// Tornar funções disponíveis globalmente
window.loadUnpaidClients = loadUnpaidClients;
window.markAsPaid = markAsPaid;
window.contactClient = contactClient;
window.openAddUnpaidModal = openAddUnpaidModal;
window.closeAddUnpaidModal = closeAddUnpaidModal;
window.updateUnpaidServicePrice = updateUnpaidServicePrice;
window.addUnpaidClient = addUnpaidClient;

// Funções de gerenciamento de clientes
window.loadClients = loadClients;
window.openAddClientModal = openAddClientModal;
window.closeAddClientModal = closeAddClientModal;
window.addClient = addClient;
window.openEditClientModal = openEditClientModal;
window.closeEditClientModal = closeEditClientModal;
window.updateClient = updateClient;
window.deleteClient = deleteClient;
window.contactClientDirect = contactClientDirect;

// Funções do modal rápido
window.openQuickClientModal = openQuickClientModal;
window.closeQuickClientModal = closeQuickClientModal;
window.addQuickClient = addQuickClient;

// ==================== MODAL DE BUSCA DE CLIENTES ====================

let currentClientSearchContext = null; // 'add', 'edit', 'unpaid'

// Função para abrir modal de busca de clientes
function openClientSearchModal(context) {
    currentClientSearchContext = context;
    const modal = document.getElementById('clientSearchModal');
    modal.style.display = 'block';

    // Limpar busca
    document.getElementById('clientSearchInput').value = '';
    document.getElementById('clientSearchResults').innerHTML = '<div class="search-loading">Digite pelo menos 2 caracteres para buscar...</div>';

    // Focar no campo de busca
    setTimeout(() => {
        document.getElementById('clientSearchInput').focus();
    }, 100);
}

// Função para fechar modal de busca de clientes
function closeClientSearchModal() {
    const modal = document.getElementById('clientSearchModal');
    modal.style.display = 'none';
    currentClientSearchContext = null;

    // Limpar busca
    document.getElementById('clientSearchInput').value = '';
    document.getElementById('clientSearchResults').innerHTML = '<div class="search-loading">Digite pelo menos 2 caracteres para buscar...</div>';
}

// Função para buscar clientes existentes
async function searchExistingClients() {
    const searchInput = document.getElementById('clientSearchInput');
    const resultsContainer = document.getElementById('clientSearchResults');
    const query = searchInput.value.trim().toLowerCase();

    if (query.length < 2) {
        resultsContainer.innerHTML = '<div class="search-loading">Digite pelo menos 2 caracteres para buscar...</div>';
        return;
    }

    if (!supabaseClient) {
        resultsContainer.innerHTML = '<div class="search-loading">Funcionalidade disponível apenas com Supabase configurado</div>';
        return;
    }

    try {
        resultsContainer.innerHTML = '<div class="search-loading">Buscando clientes...</div>';

        // Buscar clientes que correspondem ao termo
        const { data: clients, error } = await supabaseClient
            .from('clientes')
            .select('*')
            .or(`nome.ilike.%${query}%,telefone.ilike.%${query}%`)
            .order('nome');

        if (error) throw error;

        if (!clients || clients.length === 0) {
            resultsContainer.innerHTML = '<div class="search-loading">Nenhum cliente encontrado</div>';
            return;
        }

        // Exibir resultados
        resultsContainer.innerHTML = '';
        clients.forEach(client => {
            const clientItem = document.createElement('div');
            clientItem.className = 'client-result-item';
            clientItem.innerHTML = `
                <div class="client-result-name">${client.nome}</div>
                <div class="client-result-phone">${client.telefone}</div>
                ${client.email ? `<div class="client-result-email">${client.email}</div>` : ''}
            `;

            clientItem.addEventListener('click', () => {
                selectClientFromSearch(client);
            });

            resultsContainer.appendChild(clientItem);
        });

    } catch (error) {
        console.error('Erro ao buscar clientes:', error);
        resultsContainer.innerHTML = '<div class="search-loading">Erro ao buscar clientes</div>';
    }
}

// Função para selecionar cliente da busca
function selectClientFromSearch(client) {
    let nomeField, telefoneField, dddField, numeroField;

    switch (currentClientSearchContext) {
        case 'add':
            nomeField = document.getElementById('addNome');
            telefoneField = document.getElementById('addTelefone');
            dddField = document.getElementById('addDDD');
            numeroField = document.getElementById('addNumero');
            break;
        case 'edit':
            nomeField = document.getElementById('editNome');
            telefoneField = document.getElementById('editTelefone');
            dddField = document.getElementById('editDDD');
            numeroField = document.getElementById('editNumero');
            // Definir cliente selecionado para o autocomplete
            selectedClientId = client.id;
            break;
        case 'unpaid':
            nomeField = document.getElementById('addUnpaidNome');
            telefoneField = document.getElementById('addUnpaidTelefone');
            break;
        case 'retro':
            nomeField = document.getElementById('retroNome');
            dddField = document.getElementById('retroDDD');
            numeroField = document.getElementById('retroNumero');
            document.getElementById('retroClienteId').value = client.id;
            selectedRetroClientId = client.id;
            // Criar um telefoneField virtual para compatibilidade
            telefoneField = { value: '' };
            break;
    }

    if (nomeField && telefoneField) {
        nomeField.value = client.nome;
        telefoneField.value = client.telefone;

        // Desmembrar telefone nos campos segmentados
        if (dddField && numeroField) {
            desmembrarTelefone(client.telefone, dddField.id, numeroField.id);
        }
    }

    closeClientSearchModal();
    showNotification(`Cliente ${client.nome} selecionado!`, 'success');
}

// Funções do modal de busca
window.openClientSearchModal = openClientSearchModal;
window.closeClientSearchModal = closeClientSearchModal;
window.searchExistingClients = searchExistingClients;

// ==================== IMPORTAÇÃO DE CSV ====================

let csvParsedData = []; // Dados parseados do CSV
let csvValidContacts = []; // Contatos válidos para importar

// Função para abrir modal de importação CSV
// ==================== IMPORTAÇÃO DE CONTATOS VIA WEBHOOK ====================

// Função para abrir modal de importação de contatos
function openImportContactsModal() {
    const modal = document.getElementById('importContactsModal');
    modal.style.display = 'block';

    // Resetar estado
    document.getElementById('importContactsName').value = '';
    document.getElementById('importContactsStatus').style.display = 'none';
    document.getElementById('importContactsStatus').innerHTML = '';
}

// Função para fechar modal de importação de contatos
function closeImportContactsModal() {
    const modal = document.getElementById('importContactsModal');
    modal.style.display = 'none';
}

// Função para importar contatos do WhatsApp via webhook n8n
async function importContactsFromWhatsApp() {
    const nome = document.getElementById('importContactsName').value.trim();

    if (!nome) {
        showNotification('Por favor, informe seu primeiro nome.', 'warning');
        document.getElementById('importContactsName').focus();
        return;
    }

    const statusDiv = document.getElementById('importContactsStatus');
    statusDiv.style.display = 'block';
    statusDiv.style.background = 'rgba(23, 162, 184, 0.2)';
    statusDiv.style.color = '#17a2b8';
    statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando contatos, aguarde...';

    try {
        const response = await fetch('https://n8n.saslabs.tech/webhook/importar-contatos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nome: nome })
        });

        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status}`);
        }

        const result = await response.json();

        // Mostrar resultado de sucesso
        statusDiv.style.background = 'rgba(40, 167, 69, 0.2)';
        statusDiv.style.color = '#28a745';

        if (result.total_importados !== undefined) {
            statusDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${result.total_importados} contatos importados com sucesso!`;
        } else if (result.message) {
            statusDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${result.message}`;
        } else {
            statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> Importação iniciada! Os contatos serão processados em breve.';
        }

        showNotification('Importação de contatos iniciada!', 'success');

        // Recarregar lista de clientes após 3 segundos
        setTimeout(() => {
            loadClients();
            closeImportContactsModal();
        }, 3000);

    } catch (error) {
        console.error('Erro ao importar contatos:', error);
        statusDiv.style.background = 'rgba(220, 53, 69, 0.2)';
        statusDiv.style.color = '#dc3545';
        statusDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> Erro: ${error.message}`;
        showNotification('Erro ao importar contatos: ' + error.message, 'error');
    }
}

// Expor funções de importação de contatos
window.openImportContactsModal = openImportContactsModal;
window.closeImportContactsModal = closeImportContactsModal;
window.importContactsFromWhatsApp = importContactsFromWhatsApp;

// =====================================================
// SCROLL HORIZONTAL MOBILE - Indicador de deslize
// =====================================================

function initScrollIndicators() {
    // Selecionar todos os containers de tabela
    const tableContainers = document.querySelectorAll(
        '.appointments-table-container, .clients-table-container, .unpaid-table-container'
    );

    tableContainers.forEach(container => {
        // Adicionar evento de scroll
        container.addEventListener('scroll', function () {
            // Se já scrollou, adicionar classe 'scrolled' para ocultar o indicador
            if (this.scrollLeft > 10) {
                this.classList.add('scrolled');
            } else {
                this.classList.remove('scrolled');
            }
        }, { passive: true });

        // Verificar se precisa do indicador na inicialização
        checkScrollIndicator(container);
    });
}

function checkScrollIndicator(container) {
    // Se o conteúdo não é maior que o container, ocultar o indicador
    if (container.scrollWidth <= container.clientWidth) {
        container.classList.add('scrolled');
    }
}

// Inicializar indicadores quando a página carregar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollIndicators);
} else {
    initScrollIndicators();
}

// Re-verificar indicadores quando mudar de seção ou carregar dados
const originalShowSection = window.showSection;
if (originalShowSection) {
    window.showSection = function (sectionId) {
        originalShowSection(sectionId);
        setTimeout(initScrollIndicators, 100);
    };
}

// ========================================
// FILTRO DE AGENDAMENTOS NO MODAL INADIMPLENTE
// ========================================
let allAppointmentsData = [];
let originalAppointmentsData = []; // Cópia permanente dos dados originais

function clearAppointmentFilters() {
    document.getElementById('filterByClient').value = '';
    document.getElementById('filterByService').value = '';
    document.getElementById('filterByDate').value = '';

    // Dispara o evento de mudança para atualizar a lista
    const event = new Event('change');
    document.getElementById('filterByClient').dispatchEvent(event);
}

function initAppointmentFilter() {
    const filterClient = document.getElementById('filterByClient');
    const filterService = document.getElementById('filterByService');
    const filterDate = document.getElementById('filterByDate');
    const select = document.getElementById('addUnpaidAppointment');

    if (!filterClient || !filterService || !filterDate || !select) return;

    let isFiltering = false;
    let isObserving = false;

    // Popula filtros com valores únicos dos agendamentos ORIGINAIS
    function populateFilters() {
        if (originalAppointmentsData.length === 0) return;

        // Salva valores selecionados
        const currentClient = filterClient.value;
        const currentService = filterService.value;

        // Clientes únicos - sempre usa dados ORIGINAIS
        const clients = [...new Set(originalAppointmentsData.map(apt => apt.clientName).filter(Boolean))].sort();
        filterClient.innerHTML = '<option value="">Todos os Clientes</option>';
        clients.forEach(client => {
            const opt = document.createElement('option');
            opt.value = client;
            opt.textContent = client;
            if (client === currentClient) opt.selected = true;
            filterClient.appendChild(opt);
        });

        // Serviços únicos - sempre usa dados ORIGINAIS
        const services = [...new Set(originalAppointmentsData.map(apt => apt.serviceName).filter(Boolean))].sort();
        filterService.innerHTML = '<option value="">Todos os Serviços</option>';
        services.forEach(service => {
            const opt = document.createElement('option');
            opt.value = service;
            opt.textContent = service;
            if (service === currentService) opt.selected = true;
            filterService.appendChild(opt);
        });
    }

    // Filtra agendamentos baseado nos critérios selecionados
    function filterAppointments() {
        if (isFiltering || originalAppointmentsData.length === 0) return;

        isFiltering = true;

        const selectedClient = filterClient.value.trim();
        const selectedService = filterService.value.trim();
        const selectedDate = filterDate.value.trim();

        // Sempre filtra a partir dos dados ORIGINAIS
        let filtered = originalAppointmentsData;

        // Aplica filtro de cliente
        if (selectedClient) {
            filtered = filtered.filter(apt => apt.clientName === selectedClient);
        }

        // Aplica filtro de serviço
        if (selectedService) {
            filtered = filtered.filter(apt => apt.serviceName === selectedService);
        }

        // Aplica filtro de data
        if (selectedDate) {
            filtered = filtered.filter(apt => apt.date === selectedDate);
        }

        // Atualiza o select com os resultados
        select.innerHTML = '';

        if (filtered.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Nenhum agendamento encontrado';
            opt.disabled = true;
            select.appendChild(opt);
        } else {
            filtered.forEach(apt => {
                const opt = document.createElement('option');
                opt.value = apt.value;
                opt.textContent = apt.text;
                if (apt.dataset) opt.dataset.appointment = apt.dataset;
                select.appendChild(opt);
            });
        }

        isFiltering = false;
    }

    // Eventos de mudança nos filtros
    filterClient.addEventListener('change', filterAppointments);
    filterService.addEventListener('change', filterAppointments);
    filterDate.addEventListener('change', filterAppointments);

    // Observer para detectar quando o select é populado dinamicamente (primeira vez)
    const observer = new MutationObserver((mutations) => {
        if (!isFiltering && !isObserving) {
            isObserving = true;

            // Extrai dados dos agendamentos apenas se os dados originais estão vazios
            const options = Array.from(select.options).filter(opt => opt.value && opt.value !== '');

            if (options.length > 0 && originalAppointmentsData.length === 0) {
                originalAppointmentsData = options.map(opt => {
                    const text = opt.textContent || '';
                    // Formato: "Cliente - Serviço - DD/MM/YYYY HH:MM-HH:MM (status)"
                    const parts = text.split(' - ');
                    const clientName = parts[0] ? parts[0].trim() : '';
                    const serviceName = parts[1] ? parts[1].trim() : '';
                    const dateTimePart = parts[2] || '';
                    const dateStr = dateTimePart.split(' ')[0] || '';

                    // Converte DD/MM/YYYY para YYYY-MM-DD
                    let date = '';
                    if (dateStr && dateStr.includes('/')) {
                        const dateParts = dateStr.split('/');
                        if (dateParts.length === 3) {
                            const [day, month, year] = dateParts;
                            date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                        }
                    }

                    return {
                        value: opt.value,
                        text: text,
                        dataset: opt.dataset.appointment || '',
                        clientName,
                        serviceName,
                        date
                    };
                });

                allAppointmentsData = [...originalAppointmentsData]; // Cópia
                populateFilters();
            }

            setTimeout(() => { isObserving = false; }, 100);
        }
    });

    observer.observe(select, { childList: true, subtree: false });
}

// Inicializa o filtro quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAppointmentFilter);
} else {
    initAppointmentFilter();
}

// Exporta função para uso global
window.clearAppointmentFilters = clearAppointmentFilters;
