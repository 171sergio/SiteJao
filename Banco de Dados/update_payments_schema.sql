-- ADICIONA TODAS AS COLUNAS FINANCEIRAS NECESSÁRIAS
ALTER TABLE agendamentos 
ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(50),
ADD COLUMN IF NOT EXISTS valor_liquido DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS taxa_aplicada DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS preco_cobrado DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS status_pagamento VARCHAR(50) DEFAULT 'pendente',
ADD COLUMN IF NOT EXISTS valor_pago DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS valor_pendente DECIMAL(10,2) DEFAULT 0;

-- Atualiza registros antigos para terem valores consistentes
UPDATE agendamentos SET preco_cobrado = preco WHERE preco_cobrado IS NULL;

-- DEFINIR PIX COMO PADRÃO PARA AGENDAMENTOS ANTERIORES (Pedido do Usuário)
UPDATE agendamentos SET forma_pagamento = 'pix' WHERE forma_pagamento IS NULL;
UPDATE agendamentos SET status_pagamento = 'pago' WHERE status = 'concluido' AND status_pagamento = 'pendente';

-- Garantir que valor_liquido esteja preenchido para os antigos (PIX = taxa 0)
UPDATE agendamentos SET valor_liquido = preco_cobrado, taxa_aplicada = 0 
WHERE forma_pagamento = 'pix' AND valor_liquido IS NULL;

-- Recria a View corretamente
DROP VIEW IF EXISTS vw_agendamentos_completos;

CREATE OR REPLACE VIEW vw_agendamentos_completos AS
SELECT 
    a.id,
    a.cliente_id,
    a.servico_id,
    a.data_horario,
    a.horario_inicio,
    a.horario_fim,
    a.observacoes,
    a.status,
    a.criado_em,
    a.preco,
    a.nome_cliente,
    a.telefone,
    
    -- Colunas Financeiras
    a.preco_cobrado,
    a.forma_pagamento,
    a.valor_liquido,
    a.taxa_aplicada,
    a.status_pagamento,
    a.valor_pago,
    a.valor_pendente,

    -- Joins
    c.nome as cliente_nome_completo,
    c.telefone as cliente_telefone,
    s.nome as servico_nome,
    s.duracao_minutos
FROM agendamentos a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN servicos s ON a.servico_id = s.id;
