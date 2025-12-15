-- =====================================================
-- BANCO OTIMIZADO - BARBEARIA DO JÃO
-- Compatível com Bot WhatsApp (n8n) + Site de Gestão
-- ARQUIVO ÚNICO - EXECUTE TUDO DE UMA VEZ NO SUPABASE
-- =====================================================
-- IMPORTANTE: Este arquivo substitui todos os outros
-- Remova os antigos: schema_completo.sql, remover_normalizacao.sql, corrigir_triggers.sql

-- 1. LIMPAR ESTRUTURA ANTIGA (se existir)
DROP TABLE IF EXISTS inadimplentes CASCADE;
DROP TABLE IF EXISTS pagamentos CASCADE;
DROP TABLE IF EXISTS logs_atendimento CASCADE;
DROP TABLE IF EXISTS agendamentos CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS servicos CASCADE;
DROP TABLE IF EXISTS config_barbearia CASCADE;

DROP VIEW IF EXISTS vw_agendamentos_hoje CASCADE;
DROP VIEW IF EXISTS vw_agendamentos_completos CASCADE;
DROP FUNCTION IF EXISTS atualizar_cliente_apos_agendamento CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS sincronizar_cliente_agendamento CASCADE;
DROP FUNCTION IF EXISTS normalizar_telefone CASCADE;
DROP FUNCTION IF EXISTS normalizar_telefone_clientes CASCADE;
DROP FUNCTION IF EXISTS normalizar_telefone_agendamentos CASCADE;
DROP FUNCTION IF EXISTS atualizar_dias_atraso CASCADE;

-- =====================================================
-- 2. TABELAS PRINCIPAIS
-- =====================================================

-- CLIENTES
-- CONSTRAINT: Não podem existir dois clientes com o mesmo telefone
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    telefone VARCHAR(20) UNIQUE NOT NULL,  -- CONSTRAINT UNIQUE previne duplicatas
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

-- Índices para clientes
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
-- CONSTRAINT: telefone NUNCA é NULL (obrigatório)
CREATE TABLE agendamentos (
    id SERIAL PRIMARY KEY,
    
    -- Campos relacionais (usados pelo site) - NULLABLE para o bot funcionar
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    servico_id INTEGER REFERENCES servicos(id) ON DELETE SET NULL,
    
    -- Campos diretos (usados pelo bot) - OBRIGATÓRIOS E NÃO NULL
    telefone VARCHAR(20) NOT NULL DEFAULT '',  -- Padrão: string vazia se não fornecido
    nome_cliente VARCHAR(100) NOT NULL DEFAULT '',  -- Padrão: string vazia
    servico VARCHAR(100) NOT NULL DEFAULT '',  -- Padrão: string vazia
    
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

-- Índices para agendamentos
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

-- Índices para logs
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

-- Função para atualizar timestamp de atualização
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger de atualização em clientes
CREATE TRIGGER trigger_update_clientes_atualizado_em
BEFORE UPDATE ON clientes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger de atualização em agendamentos
CREATE TRIGGER trigger_update_agendamentos_atualizado_em
BEFORE UPDATE ON agendamentos
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger de atualização em servicos
CREATE TRIGGER trigger_update_servicos_atualizado_em
BEFORE UPDATE ON servicos
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger de atualização em config_barbearia
CREATE TRIGGER trigger_update_config_barbearia_atualizado_em
BEFORE UPDATE ON config_barbearia
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger de atualização em inadimplentes
CREATE TRIGGER trigger_update_inadimplentes_atualizado_em
BEFORE UPDATE ON inadimplentes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 4. FUNÇÃO: Sincronizar cliente após agendamento
-- =====================================================
-- Quando um agendamento é criado/atualizado via site, sincroniza cliente_id
CREATE OR REPLACE FUNCTION sincronizar_cliente_agendamento()
RETURNS TRIGGER AS $$
BEGIN
    -- Se cliente_id está NULL e telefone foi fornecido, buscar cliente existente
    IF NEW.cliente_id IS NULL AND NEW.telefone IS NOT NULL AND NEW.telefone != '' THEN
        SELECT id INTO NEW.cliente_id
        FROM clientes
        WHERE telefone = NEW.telefone
        LIMIT 1;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sincronizar_cliente_agendamento
BEFORE INSERT OR UPDATE ON agendamentos
FOR EACH ROW
EXECUTE FUNCTION sincronizar_cliente_agendamento();

-- =====================================================
-- 5. FUNÇÃO: Atualizar estatísticas do cliente
-- =====================================================
-- Atualiza total de agendamentos e último agendamento do cliente
CREATE OR REPLACE FUNCTION atualizar_cliente_apos_agendamento()
RETURNS TRIGGER AS $$
BEGIN
    -- Se tem cliente_id, atualizar suas estatísticas
    IF NEW.cliente_id IS NOT NULL THEN
        UPDATE clientes
        SET 
            total_agendamentos = (
                SELECT COUNT(*) FROM agendamentos 
                WHERE cliente_id = NEW.cliente_id AND status != 'cancelado'
            ),
            ultimo_agendamento = (
                SELECT MAX(data_horario) FROM agendamentos 
                WHERE cliente_id = NEW.cliente_id AND status != 'cancelado'
            )
        WHERE id = NEW.cliente_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_atualizar_cliente_apos_agendamento
AFTER INSERT OR UPDATE ON agendamentos
FOR EACH ROW
EXECUTE FUNCTION atualizar_cliente_apos_agendamento();

-- =====================================================
-- 6. FUNÇÃO: Calcular dias de atraso para inadimplentes
-- =====================================================
CREATE OR REPLACE FUNCTION atualizar_dias_atraso()
RETURNS TRIGGER AS $$
BEGIN
    NEW.dias_atraso = EXTRACT(DAY FROM (CURRENT_DATE - NEW.data_vencimento))::INTEGER;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_atualizar_dias_atraso
BEFORE INSERT OR UPDATE ON inadimplentes
FOR EACH ROW
EXECUTE FUNCTION atualizar_dias_atraso();

-- =====================================================
-- 7. VIEWS
-- =====================================================

-- View: Agendamentos de hoje
CREATE VIEW vw_agendamentos_hoje AS
SELECT 
    a.*,
    c.nome as cliente_nome,
    c.telefone as cliente_telefone,
    s.nome as servico_nome,
    s.preco_base
FROM agendamentos a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN servicos s ON a.servico_id = s.id
WHERE DATE(a.data_horario) = CURRENT_DATE
ORDER BY a.horario_inicio ASC;

-- View: Agendamentos com informações completas
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
    COALESCE(c.email, '') as cliente_email,
    COALESCE(c.status_cliente, 'ativo') as status_cliente
FROM agendamentos a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN servicos s ON a.servico_id = s.id;

-- =====================================================
-- 8. DADOS INICIAIS
-- =====================================================

-- Serviços padrão
INSERT INTO servicos (nome, preco_base, duracao_minutos, categoria) VALUES
    ('Corte Masculino', 30.00, 30, 'corte'),
    ('Corte Infantil', 25.00, 25, 'corte'),
    ('Barba', 20.00, 20, 'barba'),
    ('Corte + Barba', 45.00, 45, 'combo'),
    ('Coloração', 50.00, 60, 'coloração'),
    ('Hidratação', 35.00, 40, 'tratamento')
ON CONFLICT (nome) DO NOTHING;

-- Configurações padrão
INSERT INTO config_barbearia (categoria, chave, valor, tipo_valor, descricao) VALUES
    ('horario', 'abre_segunda', '09:00', 'hora', 'Horário de abertura na segunda'),
    ('horario', 'fecha_segunda', '18:00', 'hora', 'Horário de fechamento na segunda'),
    ('horario', 'abre_terca', '09:00', 'hora', 'Horário de abertura na terça'),
    ('horario', 'fecha_terca', '18:00', 'hora', 'Horário de fechamento na terça'),
    ('horario', 'abre_quarta', '09:00', 'hora', 'Horário de abertura na quarta'),
    ('horario', 'fecha_quarta', '18:00', 'hora', 'Horário de fechamento na quarta'),
    ('horario', 'abre_quinta', '09:00', 'hora', 'Horário de abertura na quinta'),
    ('horario', 'fecha_quinta', '18:00', 'hora', 'Horário de fechamento na quinta'),
    ('horario', 'abre_sexta', '09:00', 'hora', 'Horário de abertura na sexta'),
    ('horario', 'fecha_sexta', '19:00', 'hora', 'Horário de fechamento na sexta'),
    ('horario', 'abre_sabado', '09:00', 'hora', 'Horário de abertura no sábado'),
    ('horario', 'fecha_sabado', '17:00', 'hora', 'Horário de fechamento no sábado'),
    ('horario', 'abre_domingo', '10:00', 'hora', 'Horário de abertura no domingo'),
    ('horario', 'fecha_domingo', '17:00', 'hora', 'Horário de fechamento no domingo'),
    ('empresa', 'nome', 'Barbearia do Jão', 'texto', 'Nome da barbearia'),
    ('empresa', 'telefone', '5511999999999', 'texto', 'Telefone da barbearia'),
    ('empresa', 'whatsapp', '5511999999999', 'texto', 'WhatsApp da barbearia'),
    ('empresa', 'email', 'contato@barbearia.com.br', 'texto', 'Email da barbearia'),
    ('empresa', 'endereco', 'Rua Exemplo, 123', 'texto', 'Endereço da barbearia')
ON CONFLICT (categoria, chave) DO NOTHING;

-- =====================================================
-- ✅ FIM DO ARQUIVO - TUDO PRONTO
-- =====================================================
-- O banco agora tem:
-- ✅ CONSTRAINT UNIQUE em clientes.telefone (evita duplicatas)
-- ✅ Sem triggers de normalização de telefone (frontend faz isso)
-- ✅ Campos NOT NULL em agendamentos com valores padrão
-- ✅ Índices para performance
-- ✅ Views para consultas comuns
-- ✅ Dados iniciais (serviços e configurações)
--
-- Próximo passo: Atualizar o JavaScript do site (script.js)
-- =====================================================

COMMIT;
