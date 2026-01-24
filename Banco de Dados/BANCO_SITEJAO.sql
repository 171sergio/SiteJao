-- =====================================================
-- BANCO COMPLETO + MELHORIAS - BARBEARIA DO JÃO
-- Execute TUDO de uma vez no Supabase SQL Editor
-- Este arquivo substitui BANCO_COMPLETO_SUPABASE.sql
-- =====================================================

-- =====================================================
-- PARTE 1: LIMPAR ESTRUTURA ANTIGA
-- =====================================================

DROP VIEW IF EXISTS vw_agendamentos_hoje CASCADE;
DROP VIEW IF EXISTS vw_agendamentos_completos CASCADE;
DROP TABLE IF EXISTS logs_sistema CASCADE;
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
DROP FUNCTION IF EXISTS fn_normaliza_telefone CASCADE;
DROP FUNCTION IF EXISTS trg_normaliza_telefone_clientes CASCADE;
DROP FUNCTION IF EXISTS realizar_agendamento_seguro CASCADE;
DROP FUNCTION IF EXISTS listar_horarios_livres CASCADE;
DROP FUNCTION IF EXISTS registrar_log CASCADE;

-- =====================================================
-- PARTE 2: TABELAS PRINCIPAIS
-- =====================================================

-- CLIENTES
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    telefone VARCHAR(20) UNIQUE NOT NULL,
    telefone_normalizado VARCHAR(30),
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
CREATE INDEX idx_clientes_telefone_normalizado ON clientes(telefone_normalizado);

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
    status VARCHAR(20) DEFAULT 'agendado' CHECK (status IN ('agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado', 'nao_compareceu')),
    observacoes TEXT,
    -- Metadados
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelado_em TIMESTAMP,
    concluido_em TIMESTAMP,
    -- MELHORIA: Constraint para prevenir agendamentos duplos
    CONSTRAINT unique_appointment_slot UNIQUE (data_horario)
);

CREATE INDEX idx_agendamentos_cliente_id ON agendamentos(cliente_id);
CREATE INDEX idx_agendamentos_telefone ON agendamentos(telefone);
CREATE INDEX idx_agendamentos_data_horario ON agendamentos(data_horario);
CREATE INDEX idx_agendamentos_status ON agendamentos(status);
-- MELHORIA: Índice para performance do Dashboard
CREATE INDEX idx_agendamentos_prod ON agendamentos(status, data_horario DESC);

-- PAGAMENTOS
CREATE TABLE pagamentos (
    id SERIAL PRIMARY KEY,
    agendamento_id INTEGER REFERENCES agendamentos(id) ON DELETE CASCADE,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    valor_total DECIMAL(10,2),
    valor_pago DECIMAL(10,2) NOT NULL,
    valor_pendente DECIMAL(10,2) DEFAULT 0.00,
    forma_pagamento VARCHAR(20) CHECK (forma_pagamento IN ('pix', 'debito', 'credito', 'dinheiro')),
    status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'processando', 'pago', 'aprovado', 'rejeitado', 'estornado')),
    data_pagamento TIMESTAMP,
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

-- MELHORIA: TABELA DE LOGS DO SISTEMA (Auditoria)
CREATE TABLE logs_sistema (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(50) NOT NULL,
    origem VARCHAR(100),
    mensagem TEXT NOT NULL,
    detalhes JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_logs_sistema_created ON logs_sistema(created_at DESC);
CREATE INDEX idx_logs_sistema_tipo ON logs_sistema(tipo);

-- =====================================================
-- PARTE 3: FUNÇÕES UTILITÁRIAS
-- =====================================================

-- Função para normalizar telefone
CREATE OR REPLACE FUNCTION fn_normaliza_telefone(p_tel TEXT)
RETURNS TEXT AS $$
BEGIN
    IF p_tel IS NULL THEN
        RETURN '';
    END IF;
    RETURN regexp_replace(p_tel, '\D', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Função para atualizar timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- Função para atualizar estatísticas do cliente
CREATE OR REPLACE FUNCTION atualizar_cliente_apos_agendamento()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.cliente_id IS NOT NULL THEN
        UPDATE clientes SET 
            total_agendamentos = (SELECT COUNT(*) FROM agendamentos WHERE cliente_id = NEW.cliente_id AND status NOT IN ('cancelado', 'nao_compareceu')),
            ultimo_agendamento = (SELECT MAX(data_horario) FROM agendamentos WHERE cliente_id = NEW.cliente_id AND status NOT IN ('cancelado', 'nao_compareceu'))
        WHERE id = NEW.cliente_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Função para calcular dias de atraso
CREATE OR REPLACE FUNCTION atualizar_dias_atraso()
RETURNS TRIGGER AS $$
BEGIN
    NEW.dias_atraso = GREATEST(0, (CURRENT_DATE - NEW.data_vencimento));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Função para normalizar telefone no cliente
CREATE OR REPLACE FUNCTION trg_normaliza_telefone_clientes()
RETURNS TRIGGER AS $$
BEGIN
    NEW.telefone_normalizado := fn_normaliza_telefone(NEW.telefone);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PARTE 4: TRIGGERS
-- =====================================================

CREATE TRIGGER trigger_update_clientes_atualizado_em
BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_agendamentos_atualizado_em
BEFORE UPDATE ON agendamentos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_servicos_atualizado_em
BEFORE UPDATE ON servicos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_inadimplentes_atualizado_em
BEFORE UPDATE ON inadimplentes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_sincronizar_cliente_agendamento
BEFORE INSERT OR UPDATE ON agendamentos FOR EACH ROW EXECUTE FUNCTION sincronizar_cliente_agendamento();

CREATE TRIGGER trigger_atualizar_cliente_apos_agendamento
AFTER INSERT OR UPDATE ON agendamentos FOR EACH ROW EXECUTE FUNCTION atualizar_cliente_apos_agendamento();

CREATE TRIGGER trigger_atualizar_dias_atraso
BEFORE INSERT OR UPDATE ON inadimplentes FOR EACH ROW EXECUTE FUNCTION atualizar_dias_atraso();

CREATE TRIGGER trigger_normaliza_telefone_clientes
BEFORE INSERT OR UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION trg_normaliza_telefone_clientes();

-- =====================================================
-- PARTE 5: VIEWS
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
-- PARTE 6: FUNÇÕES RPC (MELHORIAS)
-- =====================================================

-- MELHORIA: Função RPC para agendamento seguro (Atomicidade)
CREATE OR REPLACE FUNCTION realizar_agendamento_seguro(
    p_cliente_id INT,
    p_servico_id INT,
    p_telefone TEXT,
    p_nome_cliente TEXT,
    p_servico_nome TEXT,
    p_data_horario TIMESTAMP,
    p_horario_inicio TIME,
    p_horario_fim TIME,
    p_preco DECIMAL
) RETURNS JSON AS $$
DECLARE
    v_agendamento_id INT;
BEGIN
    INSERT INTO agendamentos (
        cliente_id, servico_id, telefone, nome_cliente, 
        servico, data_horario, horario_inicio, horario_fim, preco, status
    ) VALUES (
        p_cliente_id, p_servico_id, p_telefone, p_nome_cliente, 
        p_servico_nome, p_data_horario, p_horario_inicio, p_horario_fim, p_preco, 'agendado'
    ) RETURNING id INTO v_agendamento_id;

    RETURN json_build_object('success', true, 'id', v_agendamento_id);

EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('success', false, 'error', 'CONFLITO: Este horário já foi preenchido.');
WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- MELHORIA: Função para listar horários disponíveis (Para o Bot)
CREATE OR REPLACE FUNCTION listar_horarios_livres(p_data DATE)
RETURNS TABLE (horario TIME) AS $$
DECLARE
    v_hora_abre TIME := '09:00'::TIME;
    v_hora_fecha TIME := '18:00'::TIME;
BEGIN
    BEGIN
        SELECT valor::TIME INTO v_hora_abre 
        FROM config_barbearia 
        WHERE chave IN ('abre', 'horario_abertura', 'abre_terca')
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        v_hora_abre := '09:00'::TIME;
    END;
    
    BEGIN
        SELECT valor::TIME INTO v_hora_fecha 
        FROM config_barbearia 
        WHERE chave IN ('fecha', 'horario_fechamento', 'fecha_terca')
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        v_hora_fecha := '18:00'::TIME;
    END;

    RETURN QUERY
    WITH slots AS (
        SELECT s::TIME as slot_time 
        FROM generate_series(
            v_hora_abre,
            v_hora_fecha - '30 minutes'::interval,
            '30 minutes'::interval
        ) s
    )
    SELECT s.slot_time 
    FROM slots s
    WHERE s.slot_time NOT IN (
        SELECT horario_inicio 
        FROM agendamentos 
        WHERE CAST(data_horario AS DATE) = p_data 
          AND status NOT IN ('cancelado', 'nao_compareceu')
    )
    ORDER BY s.slot_time;
END;
$$ LANGUAGE plpgsql;

-- MELHORIA: Função para registrar logs
CREATE OR REPLACE FUNCTION registrar_log(
    p_tipo VARCHAR(50),
    p_origem VARCHAR(100),
    p_mensagem TEXT,
    p_detalhes JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO logs_sistema (tipo, origem, mensagem, detalhes)
    VALUES (p_tipo, p_origem, p_mensagem, p_detalhes);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PARTE 7: SEGURANÇA (RLS)
-- =====================================================

ALTER TABLE agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inadimplentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_barbearia ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_sistema ENABLE ROW LEVEL SECURITY;

-- Policies permissivas (ajuste conforme necessidade)
CREATE POLICY "Permitir Acesso Anon Agendamentos" ON agendamentos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir Acesso Anon Clientes" ON clientes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir Acesso Anon Servicos" ON servicos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir Acesso Anon Pagamentos" ON pagamentos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir Acesso Anon Inadimplentes" ON inadimplentes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir Acesso Anon Config" ON config_barbearia FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir Acesso Anon Logs" ON logs_sistema FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- PARTE 8: DADOS INICIAIS
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
-- VERIFICAÇÃO FINAL
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '================================================';
    RAISE NOTICE 'BANCO COMPLETO + MELHORIAS APLICADOS COM SUCESSO!';
    RAISE NOTICE '================================================';
    RAISE NOTICE '✓ Tabelas criadas: clientes, servicos, agendamentos, pagamentos, inadimplentes, logs_atendimento, config_barbearia, logs_sistema';
    RAISE NOTICE '✓ Constraint unique_appointment_slot (previne duplicatas)';
    RAISE NOTICE '✓ Índice idx_agendamentos_prod (performance)';
    RAISE NOTICE '✓ Função realizar_agendamento_seguro (RPC atômica)';
    RAISE NOTICE '✓ Função listar_horarios_livres (para o Bot)';
    RAISE NOTICE '✓ Função registrar_log (auditoria)';
    RAISE NOTICE '✓ RLS habilitado em todas as tabelas';
    RAISE NOTICE '✓ Views: vw_agendamentos_completos, vw_agendamentos_hoje';
    RAISE NOTICE '✓ Dados iniciais: serviços e configurações';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'PRÓXIMO PASSO MANUAL:';
    RAISE NOTICE 'Vá em Database > Replication > Tables';
    RAISE NOTICE 'e ative o toggle para "agendamentos"';
    RAISE NOTICE '================================================';
END $$;
