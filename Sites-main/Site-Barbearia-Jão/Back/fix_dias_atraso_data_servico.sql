-- =====================================================
-- CORREÇÃO DO CÁLCULO DE DIAS DE ATRASO
-- Alterar para usar data do serviço em vez de data de vencimento
-- =====================================================

-- Criar nova função que calcula dias de atraso baseado na data do agendamento
CREATE OR REPLACE FUNCTION calcular_dias_atraso_por_servico(agendamento_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    data_servico DATE;
BEGIN
    -- Buscar a data do agendamento
    SELECT DATE(data_horario) INTO data_servico
    FROM agendamentos 
    WHERE id = agendamento_id;
    
    -- Se não encontrou o agendamento, retorna 0
    IF data_servico IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Calcular diferença em dias - se positivo, está em atraso
    IF CURRENT_DATE > data_servico THEN
        RETURN (CURRENT_DATE - data_servico)::INTEGER;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Atualizar a função de trigger para usar a nova lógica
CREATE OR REPLACE FUNCTION atualizar_dias_atraso()
RETURNS TRIGGER AS $$
BEGIN
    -- Calcular dias de atraso baseado na data do agendamento
    IF NEW.agendamento_id IS NOT NULL THEN
        NEW.dias_atraso = calcular_dias_atraso_por_servico(NEW.agendamento_id);
    ELSE
        -- Fallback para data_vencimento se não houver agendamento_id
        IF NEW.data_vencimento IS NOT NULL THEN
            NEW.dias_atraso = GREATEST(0, (CURRENT_DATE - NEW.data_vencimento)::INTEGER);
        ELSE
            NEW.dias_atraso = 0;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recriar a view de inadimplentes ativos com a nova lógica
DROP VIEW IF EXISTS vw_inadimplentes_ativos;
CREATE VIEW vw_inadimplentes_ativos AS
SELECT 
    i.*,
    calcular_dias_atraso_por_servico(i.agendamento_id) as dias_atraso_atual,
    c.nome as cliente_nome,
    c.telefone as cliente_telefone,
    a.data_horario as data_servico,
    s.nome as servico_nome
FROM inadimplentes i
JOIN clientes c ON i.cliente_id = c.id
JOIN agendamentos a ON i.agendamento_id = a.id
JOIN servicos s ON a.servico_id = s.id
WHERE i.status_cobranca IN ('pendente', 'em_cobranca', 'parcelado')
AND i.valor_restante > 0
ORDER BY calcular_dias_atraso_por_servico(i.agendamento_id) DESC;

-- Atualizar registros existentes com a nova lógica
UPDATE inadimplentes 
SET dias_atraso = calcular_dias_atraso_por_servico(agendamento_id)
WHERE agendamento_id IS NOT NULL;

-- Verificar se a correção funcionou
SELECT 
    'Correção aplicada com sucesso!' as status,
    COUNT(*) as total_inadimplentes_atualizados
FROM inadimplentes 
WHERE agendamento_id IS NOT NULL;