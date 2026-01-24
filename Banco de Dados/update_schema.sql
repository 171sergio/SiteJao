-- =====================================================
-- ATUALIZAÇÃO DE SCHEMA - BARBEARIA DO JÃO
-- 1. Permitir Telefone Opcional
-- 2. Adicionar Campos Financeiros (InfinitePay)
-- =====================================================

-- 1. Remover UNIQUE constraint do telefone em clientes (para permitir múltiplos nulos/vazios)
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_telefone_key;

-- 2. Tornar telefone opcional em clientes
ALTER TABLE clientes ALTER COLUMN telefone DROP NOT NULL;
ALTER TABLE clientes ALTER COLUMN telefone SET DEFAULT NULL;

-- 3. Adicionar campos financeiros em agendamentos
ALTER TABLE agendamentos
ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(30), -- 'pix', 'dinheiro', 'debito', 'credito_vista', 'credito_parcelado'
ADD COLUMN IF NOT EXISTS valor_liquido DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS taxa_aplicada DECIMAL(5,2) DEFAULT 0.00;

-- 4. Tornar telefone opcional em agendamentos
ALTER TABLE agendamentos ALTER COLUMN telefone DROP NOT NULL;
ALTER TABLE agendamentos ALTER COLUMN telefone SET DEFAULT '';

-- 5. Atualizar função de sincronização para não falhar com telefone nulo
CREATE OR REPLACE FUNCTION sincronizar_cliente_agendamento()
RETURNS TRIGGER AS $$
BEGIN
    -- Só tenta buscar cliente se telefone não for nulo/vazio
    IF NEW.cliente_id IS NULL AND NEW.telefone IS NOT NULL AND NEW.telefone != '' THEN
        SELECT id INTO NEW.cliente_id FROM clientes WHERE telefone = NEW.telefone LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Recriar a view para incluir os novos campos financeiros
DROP VIEW IF EXISTS vw_agendamentos_completos;
CREATE VIEW vw_agendamentos_completos AS
SELECT 
    a.id,
    a.cliente_id,
    a.servico_id,
    a.telefone,
    a.telefone as cliente_telefone,
    a.nome_cliente,
    COALESCE(c.nome, a.nome_cliente) as cliente_nome,
    COALESCE(c.nome, a.nome_cliente) as cliente_nome_completo,
    a.servico,
    s.nome as servico_nome,
    a.data_horario,
    a.horario_inicio,
    a.horario_fim,
    a.preco,
    a.preco as preco_cobrado,
    a.status,
    a.observacoes,
    a.criado_em,
    a.atualizado_em,
    a.cancelado_em,
    a.concluido_em,
    COALESCE(c.email, '') as cliente_email,
    COALESCE(c.status_cliente, 'ativo') as status_cliente,
    COALESCE(s.duracao_minutos, 30) as duracao_minutos,
    -- Novos campos financeiros
    a.forma_pagamento,
    a.valor_liquido,
    a.taxa_aplicada
FROM agendamentos a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN servicos s ON a.servico_id = s.id;
