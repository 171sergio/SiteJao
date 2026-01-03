-- =====================================================
-- BANCO COMPLETO - BARBEARIA DO JÃO
-- Compatível com Bot WhatsApp (n8n) + Site de Gestão
-- EXECUTE TUDO DE UMA VEZ NO SUPABASE SQL EDITOR
-- =====================================================

-- 1. LIMPAR ESTRUTURA ANTIGA (se existir)
DROP VIEW IF EXISTS vw_agendamentos_hoje CASCADE;
DROP VIEW IF EXISTS vw_agendamentos_completos CASCADE;
DROP TABLE IF EXISTS inadimplentes CASCADE;
DROP TABLE IF EXISTS pagamentos CASCADE;
DROP TABLE IF EXISTS logs_atendimento CASCADE;
DROP TABLE IF EXISTS agendamentos CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS servicos CASCADE;
DROP TABLE IF EXISTS config_barbearia CASCADE;
DROP FUNCTION IF EXISTS atualizar_cliente_apos_agendamento CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS sincronizar_cliente_agendamento CASCADE;
DROP FUNCTION IF EXISTS atualizar_dias_atraso CASCADE;

-- =====================================================
-- 2. TABELAS PRINCIPAIS
-- =====================================================

-- CLIENTES
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    telefone VARCHAR(20) UNIQUE NOT NULL,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    data_nascimento DATE,
    observacoes TEXT,
    cliente_desde TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultimo_agendamento TIMESTAMP,
    total_agendamentos INTEGER DEFAULT 0,
    total_gasto DECIMAL(10,2) DEFAULT 0.00,
    status_cliente VARCHAR(20) DEFAULT 'ativo' CHECK (status_cliente IN ('ativo', 'inativo', 'bloqueado')),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_clientes_telefone ON clientes(telefone);
CREATE INDEX idx_clientes_nome ON clientes(nome);

-- SERVIÇOS
CREATE TABLE servicos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) UNIQUE NOT NULL,
    descricao TEXT,
    preco_base DECIMAL(10,2) NOT NULL,
    duracao_minutos INTEGER NOT NULL DEFAULT 30,
    ativo BOOLEAN DEFAULT true,
    categoria VARCHAR(50) DEFAULT 'geral',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AGENDAMENTOS (estrutura híbrida para bot + site)
CREATE TABLE agendamentos (
    id SERIAL PRIMARY KEY,
    -- Campos relacionais (usados pelo site)
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    servico_id INTEGER REFERENCES servicos(id) ON DELETE SET NULL,
    -- Campos diretos (usados pelo bot)
    telefone VARCHAR(20) NOT NULL DEFAULT '',
    nome_cliente VARCHAR(100) NOT NULL DEFAULT '',
    servico VARCHAR(100) NOT NULL DEFAULT '',
    -- Campos compartilhados
    data_horario TIMESTAMP NOT NULL,
    horario_inicio TIME NOT NULL,
    horario_fim TIME NOT NULL,
    preco DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'agendado' CHECK (status IN ('agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado')),
    observacoes TEXT,
    -- Metadados
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelado_em TIMESTAMP,
    concluido_em TIMESTAMP
);

CREATE INDEX idx_agendamentos_cliente_id ON agendamentos(cliente_id);
CREATE INDEX idx_agendamentos_telefone ON agendamentos(telefone);
CREATE INDEX idx_agendamentos_data_horario ON agendamentos(data_horario);
CREATE INDEX idx_agendamentos_status ON agendamentos(status);

-- PAGAMENTOS
CREATE TABLE pagamentos (
    id SERIAL PRIMARY KEY,
    agendamento_id INTEGER REFERENCES agendamentos(id) ON DELETE CASCADE,
    valor_pago DECIMAL(10,2) NOT NULL,
    forma_pagamento VARCHAR(20) NOT NULL CHECK (forma_pagamento IN ('pix', 'debito', 'credito', 'dinheiro')),
    status_pagamento VARCHAR(20) DEFAULT 'aprovado' CHECK (status_pagamento IN ('pendente', 'processando', 'aprovado', 'rejeitado', 'estornado')),
    data_pagamento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    observacoes TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INADIMPLENTES
CREATE TABLE inadimplentes (
    id SERIAL PRIMARY KEY,
    agendamento_id INTEGER REFERENCES agendamentos(id) ON DELETE CASCADE,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    telefone VARCHAR(20) NOT NULL,
    nome_cliente VARCHAR(100),
    servico VARCHAR(100),
    valor_devido DECIMAL(10,2) NOT NULL,
    valor_pago DECIMAL(10,2) DEFAULT 0.00,
    valor_restante DECIMAL(10,2) NOT NULL,
    data_vencimento DATE NOT NULL,
    dias_atraso INTEGER DEFAULT 0,
    status_cobranca VARCHAR(20) DEFAULT 'pendente' CHECK (status_cobranca IN ('pendente', 'em_cobranca', 'quitado', 'cancelado')),
    tentativas_contato INTEGER DEFAULT 0,
    ultimo_contato TIMESTAMP,
    observacoes_cobranca TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LOGS DE ATENDIMENTO (bot WhatsApp)
CREATE TABLE logs_atendimento (
    id SERIAL PRIMARY KEY,
    telefone VARCHAR(20) NOT NULL,
    nome_contato VARCHAR(100),
    mensagem_recebida TEXT NOT NULL,
    resposta_enviada TEXT,
    contexto JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_logs_telefone ON logs_atendimento(telefone);
CREATE INDEX idx_logs_timestamp ON logs_atendimento(timestamp);

-- CONFIGURAÇÕES
CREATE TABLE config_barbearia (
    id SERIAL PRIMARY KEY,
    categoria VARCHAR(50) NOT NULL,
    chave VARCHAR(100) NOT NULL,
    valor TEXT NOT NULL,
    tipo_valor VARCHAR(20) DEFAULT 'texto',
    descricao TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(categoria, chave)
);

-- =====================================================
-- 3. FUNÇÕES E TRIGGERS
-- =====================================================

-- Função para atualizar timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de atualização
CREATE TRIGGER trigger_update_clientes_atualizado_em
BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_agendamentos_atualizado_em
BEFORE UPDATE ON agendamentos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_servicos_atualizado_em
BEFORE UPDATE ON servicos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_inadimplentes_atualizado_em
BEFORE UPDATE ON inadimplentes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Função para sincronizar cliente_id com telefone
CREATE OR REPLACE FUNCTION sincronizar_cliente_agendamento()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.cliente_id IS NULL AND NEW.telefone IS NOT NULL AND NEW.telefone != '' THEN
        SELECT id INTO NEW.cliente_id FROM clientes WHERE telefone = NEW.telefone LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sincronizar_cliente_agendamento
BEFORE INSERT OR UPDATE ON agendamentos FOR EACH ROW EXECUTE FUNCTION sincronizar_cliente_agendamento();

-- Função para atualizar estatísticas do cliente
CREATE OR REPLACE FUNCTION atualizar_cliente_apos_agendamento()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.cliente_id IS NOT NULL THEN
        UPDATE clientes SET 
            total_agendamentos = (SELECT COUNT(*) FROM agendamentos WHERE cliente_id = NEW.cliente_id AND status != 'cancelado'),
            ultimo_agendamento = (SELECT MAX(data_horario) FROM agendamentos WHERE cliente_id = NEW.cliente_id AND status != 'cancelado')
        WHERE id = NEW.cliente_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_atualizar_cliente_apos_agendamento
AFTER INSERT OR UPDATE ON agendamentos FOR EACH ROW EXECUTE FUNCTION atualizar_cliente_apos_agendamento();

-- Função para calcular dias de atraso
CREATE OR REPLACE FUNCTION atualizar_dias_atraso()
RETURNS TRIGGER AS $$
BEGIN
    NEW.dias_atraso = GREATEST(0, (CURRENT_DATE - NEW.data_vencimento));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_atualizar_dias_atraso
BEFORE INSERT OR UPDATE ON inadimplentes FOR EACH ROW EXECUTE FUNCTION atualizar_dias_atraso();

-- =====================================================
-- 4. VIEWS
-- =====================================================

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
    COALESCE(s.duracao_minutos, 30) as duracao_minutos
FROM agendamentos a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN servicos s ON a.servico_id = s.id;

CREATE VIEW vw_agendamentos_hoje AS
SELECT 
    a.*,
    c.nome as cliente_nome_rel,
    s.nome as servico_nome,
    s.preco_base,
    s.duracao_minutos
FROM agendamentos a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN servicos s ON a.servico_id = s.id
WHERE DATE(a.data_horario) = CURRENT_DATE
ORDER BY a.horario_inicio ASC;

-- =====================================================
-- 5. DADOS INICIAIS
-- =====================================================

INSERT INTO servicos (nome, preco_base, duracao_minutos, categoria) VALUES
    ('Corte Masculino', 30.00, 30, 'corte'),
    ('Corte Infantil', 25.00, 25, 'corte'),
    ('Barba', 20.00, 20, 'barba'),
    ('Corte + Barba', 45.00, 45, 'combo'),
    ('Máquina', 25.00, 20, 'corte'),
    ('Pezinho', 15.00, 15, 'acabamento'),
    ('Sobrancelha', 20.00, 15, 'acabamento'),
    ('Relaxamento', 20.00, 30, 'tratamento'),
    ('Luzes', 50.00, 60, 'coloração'),
    ('Platinado', 90.00, 90, 'coloração'),
    ('Combo Completo', 65.00, 60, 'combo')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO config_barbearia (categoria, chave, valor, tipo_valor, descricao) VALUES
    ('horario', 'abre_terca', '09:00', 'hora', 'Horário de abertura na terça'),
    ('horario', 'fecha_terca', '19:00', 'hora', 'Horário de fechamento na terça'),
    ('horario', 'abre_quarta', '09:00', 'hora', 'Horário de abertura na quarta'),
    ('horario', 'fecha_quarta', '19:00', 'hora', 'Horário de fechamento na quarta'),
    ('horario', 'abre_quinta', '09:00', 'hora', 'Horário de abertura na quinta'),
    ('horario', 'fecha_quinta', '19:00', 'hora', 'Horário de fechamento na quinta'),
    ('horario', 'abre_sexta', '08:00', 'hora', 'Horário de abertura na sexta'),
    ('horario', 'fecha_sexta', '19:00', 'hora', 'Horário de fechamento na sexta'),
    ('horario', 'abre_sabado', '08:00', 'hora', 'Horário de abertura no sábado'),
    ('horario', 'fecha_sabado', '17:00', 'hora', 'Horário de fechamento no sábado'),
    ('empresa', 'nome', 'Barbearia do Jão', 'texto', 'Nome da barbearia'),
    ('empresa', 'telefone', '5531999999999', 'texto', 'Telefone da barbearia')
ON CONFLICT (categoria, chave) DO NOTHING;

-- =====================================================
-- 6. NORMALIZAÇÃO DE TELEFONE + PREVENÇÃO DE DUPLICATAS
-- Independente da formatação (com/sem espaços, +55, etc.)
-- =====================================================

-- 6.1) Função utilitária para normalizar telefone (remove tudo que não for dígito)
CREATE OR REPLACE FUNCTION fn_normaliza_telefone(p_tel TEXT)
RETURNS TEXT AS $$
BEGIN
    IF p_tel IS NULL THEN
        RETURN '';
    END IF;
    RETURN regexp_replace(p_tel, '\D', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 6.2) Adicionar coluna de telefone normalizado se não existir
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='clientes' AND column_name='telefone_normalizado'
    ) THEN
        ALTER TABLE clientes ADD COLUMN telefone_normalizado VARCHAR(30);
    END IF;
END$$;

-- 6.3) Popular telefone_normalizado para registros existentes
UPDATE clientes
SET telefone_normalizado = fn_normaliza_telefone(telefone)
WHERE telefone_normalizado IS NULL OR telefone_normalizado = '';

-- 6.4) Criar tabela temporária com o cliente a manter por telefone_normalizado
CREATE TEMP TABLE clientes_unicos_normalizados AS
SELECT DISTINCT ON (telefone_normalizado) id, telefone_normalizado
FROM clientes
WHERE telefone_normalizado <> ''
ORDER BY telefone_normalizado, criado_em ASC NULLS LAST, id ASC;

-- 6.5) Identificar duplicatas
CREATE TEMP TABLE clientes_duplicados_normalizados AS
SELECT id FROM clientes
WHERE telefone_normalizado <> '' AND id NOT IN (SELECT id FROM clientes_unicos_normalizados);

-- 6.6) Atualizar referências em agendamentos para apontar ao cliente único
UPDATE agendamentos a
SET cliente_id = cu.id
FROM clientes c
JOIN clientes_unicos_normalizados cu ON c.telefone_normalizado = cu.telefone_normalizado
WHERE a.cliente_id = c.id
  AND c.id IN (SELECT id FROM clientes_duplicados_normalizados);

-- 6.7) Deletar clientes duplicados
DELETE FROM clientes WHERE id IN (SELECT id FROM clientes_duplicados_normalizados);

-- 6.8) Garantir que todos os clientes tenham telefone_normalizado preenchido
UPDATE clientes
SET telefone_normalizado = fn_normaliza_telefone(telefone)
WHERE telefone_normalizado IS NULL OR telefone_normalizado = '';

-- 6.9) Criar trigger para manter telefone_normalizado atualizado automaticamente
CREATE OR REPLACE FUNCTION trg_normaliza_telefone_clientes()
RETURNS TRIGGER AS $$
BEGIN
    NEW.telefone_normalizado := fn_normaliza_telefone(NEW.telefone);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_normaliza_telefone_clientes ON clientes;
CREATE TRIGGER trigger_normaliza_telefone_clientes
BEFORE INSERT OR UPDATE ON clientes
FOR EACH ROW EXECUTE FUNCTION trg_normaliza_telefone_clientes();

-- 6.10) Criar índice único parcial para prevenir duplicatas futuras
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'uniq_clientes_telefone_normalizado_partial'
    ) THEN
        CREATE UNIQUE INDEX uniq_clientes_telefone_normalizado_partial
        ON clientes(telefone_normalizado)
        WHERE telefone_normalizado <> '';
    END IF;
END$$;

-- 6.11) Criar índice para busca rápida
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'idx_clientes_telefone_normalizado'
    ) THEN
        CREATE INDEX idx_clientes_telefone_normalizado ON clientes(telefone_normalizado);
    END IF;
END$$;

-- 6.12) Limpeza de tabelas temporárias
DROP TABLE IF EXISTS clientes_unicos_normalizados;
DROP TABLE IF EXISTS clientes_duplicados_normalizados;

-- =====================================================
-- ✅ BANCO CRIADO COM SUCESSO!
-- Compatível com: Site + Bot WhatsApp (n8n)
-- Telefones normalizados e duplicatas prevenidas!
-- =====================================================
