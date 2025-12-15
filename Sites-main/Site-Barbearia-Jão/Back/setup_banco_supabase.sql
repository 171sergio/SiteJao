-- =====================================================
-- ESTRUTURA OTIMIZADA DO BANCO DE DADOS - BARBEARIA DO JÃO
-- Versão 2.0 - Melhorada e Otimizada
-- =====================================================

-- 1. REMOVER ESTRUTURA ANTIGA
DROP TABLE IF EXISTS inadimplentes CASCADE;
DROP TABLE IF EXISTS logs_atendimento CASCADE;
DROP TABLE IF EXISTS agendamentos CASCADE;
DROP TABLE IF EXISTS config_barbearia CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS servicos CASCADE;
DROP TABLE IF EXISTS pagamentos CASCADE;
DROP TABLE IF EXISTS notificacoes CASCADE;

-- Remover views e funções antigas
DROP VIEW IF EXISTS vw_agendamentos_hoje CASCADE;
DROP VIEW IF EXISTS vw_estatisticas_atendimento CASCADE;
DROP FUNCTION IF EXISTS verificar_conflito_horario CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;

-- =====================================================
-- 2. TABELAS PRINCIPAIS - ESTRUTURA OTIMIZADA
-- =====================================================

-- TABELA DE CLIENTES (centralizada)
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

-- TABELA DE SERVIÇOS (centralizada)
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

-- TABELA DE AGENDAMENTOS (otimizada)
CREATE TABLE agendamentos (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    servico_id INTEGER NOT NULL REFERENCES servicos(id),
    data_horario TIMESTAMP NOT NULL,
    horario_inicio TIME NOT NULL,
    horario_fim TIME NOT NULL,
    preco_cobrado DECIMAL(10,2) NOT NULL, -- Preço no momento do agendamento
    status VARCHAR(20) DEFAULT 'agendado' CHECK (status IN ('agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado')),
    observacoes TEXT,
    cancelado_por VARCHAR(20) CHECK (cancelado_por IN ('cliente', 'barbearia', 'sistema')),
    motivo_cancelamento TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelado_em TIMESTAMP,
    concluido_em TIMESTAMP
);

-- TABELA DE PAGAMENTOS (histórico completo)
CREATE TABLE pagamentos (
    id SERIAL PRIMARY KEY,
    agendamento_id INTEGER NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
    valor_pago DECIMAL(10,2) NOT NULL,
    forma_pagamento VARCHAR(20) NOT NULL CHECK (forma_pagamento IN ('pix', 'debito', 'credito', 'dinheiro')),
    status_pagamento VARCHAR(20) DEFAULT 'pendente' CHECK (status_pagamento IN ('pendente', 'processando', 'aprovado', 'rejeitado', 'estornado')),
    data_pagamento TIMESTAMP,
    referencia_externa VARCHAR(100), -- ID do PIX, transação, etc.
    observacoes TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABELA DE INADIMPLENTES (melhorada)
CREATE TABLE inadimplentes (
    id SERIAL PRIMARY KEY,
    agendamento_id INTEGER NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    telefone VARCHAR(20) NOT NULL, -- Adicionado campo telefone
    valor_devido DECIMAL(10,2) NOT NULL,
    valor_pago DECIMAL(10,2) DEFAULT 0.00,
    valor_restante DECIMAL(10,2) GENERATED ALWAYS AS (valor_devido - valor_pago) STORED,
    data_vencimento DATE NOT NULL,
    dias_atraso INTEGER DEFAULT 0, -- Removido GENERATED ALWAYS AS para evitar erro de imutabilidade
    status_cobranca VARCHAR(20) DEFAULT 'pendente' CHECK (status_cobranca IN ('pendente', 'em_cobranca', 'parcelado', 'quitado', 'cancelado')),
    tentativas_contato INTEGER DEFAULT 0,
    ultimo_contato TIMESTAMP,
    proximo_contato DATE,
    observacoes_cobranca TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABELA DE NOTIFICAÇÕES (nova)
CREATE TABLE notificacoes (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    agendamento_id INTEGER REFERENCES agendamentos(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('confirmacao', 'lembrete', 'cobranca', 'promocao', 'cancelamento')),
    titulo VARCHAR(200) NOT NULL,
    mensagem TEXT NOT NULL,
    canal VARCHAR(20) DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'sms', 'email')),
    status_envio VARCHAR(20) DEFAULT 'pendente' CHECK (status_envio IN ('pendente', 'enviado', 'entregue', 'lido', 'erro')),
    agendado_para TIMESTAMP,
    enviado_em TIMESTAMP,
    erro_envio TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABELA DE LOGS (otimizada)
CREATE TABLE logs_atendimento (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes(id),
    telefone VARCHAR(20) NOT NULL,
    tipo_interacao VARCHAR(30) NOT NULL CHECK (tipo_interacao IN ('agendamento', 'cancelamento', 'consulta', 'cobranca', 'suporte')),
    mensagem_recebida TEXT NOT NULL,
    resposta_enviada TEXT,
    contexto JSONB, -- Para armazenar dados estruturados
    duracao_processamento INTEGER,
    sucesso BOOLEAN DEFAULT true,
    erro TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABELA DE CONFIGURAÇÕES (expandida)
CREATE TABLE config_barbearia (
    id SERIAL PRIMARY KEY,
    categoria VARCHAR(50) NOT NULL,
    chave VARCHAR(100) NOT NULL,
    valor TEXT NOT NULL,
    tipo_valor VARCHAR(20) DEFAULT 'texto' CHECK (tipo_valor IN ('texto', 'numero', 'boolean', 'json', 'data', 'hora')),
    descricao TEXT,
    editavel BOOLEAN DEFAULT true,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(categoria, chave)
);

-- =====================================================
-- 3. ÍNDICES PARA PERFORMANCE
-- =====================================================

-- Clientes
CREATE INDEX idx_clientes_telefone ON clientes(telefone);
CREATE INDEX idx_clientes_nome ON clientes(nome);
CREATE INDEX idx_clientes_status ON clientes(status_cliente);

-- Serviços
CREATE INDEX idx_servicos_ativo ON servicos(ativo);
CREATE INDEX idx_servicos_categoria ON servicos(categoria);

-- Agendamentos
CREATE INDEX idx_agendamentos_cliente_id ON agendamentos(cliente_id);
CREATE INDEX idx_agendamentos_servico_id ON agendamentos(servico_id);
CREATE INDEX idx_agendamentos_data_horario ON agendamentos(data_horario);
CREATE INDEX idx_agendamentos_status ON agendamentos(status);
CREATE INDEX idx_agendamentos_data_status ON agendamentos(DATE(data_horario), status);

-- Pagamentos
CREATE INDEX idx_pagamentos_agendamento_id ON pagamentos(agendamento_id);
CREATE INDEX idx_pagamentos_status ON pagamentos(status_pagamento);
CREATE INDEX idx_pagamentos_forma ON pagamentos(forma_pagamento);
CREATE INDEX idx_pagamentos_data ON pagamentos(data_pagamento);

-- Inadimplentes
CREATE INDEX idx_inadimplentes_cliente_id ON inadimplentes(cliente_id);
CREATE INDEX idx_inadimplentes_agendamento_id ON inadimplentes(agendamento_id);
CREATE INDEX idx_inadimplentes_status ON inadimplentes(status_cobranca);
CREATE INDEX idx_inadimplentes_dias_atraso ON inadimplentes(dias_atraso);
CREATE INDEX idx_inadimplentes_proximo_contato ON inadimplentes(proximo_contato);

-- Notificações
CREATE INDEX idx_notificacoes_cliente_id ON notificacoes(cliente_id);
CREATE INDEX idx_notificacoes_tipo ON notificacoes(tipo);
CREATE INDEX idx_notificacoes_status ON notificacoes(status_envio);
CREATE INDEX idx_notificacoes_agendado ON notificacoes(agendado_para);

-- Logs
CREATE INDEX idx_logs_cliente_id ON logs_atendimento(cliente_id);
CREATE INDEX idx_logs_telefone ON logs_atendimento(telefone);
CREATE INDEX idx_logs_timestamp ON logs_atendimento(timestamp);
CREATE INDEX idx_logs_tipo ON logs_atendimento(tipo_interacao);

-- Configurações
CREATE INDEX idx_config_categoria ON config_barbearia(categoria);
CREATE INDEX idx_config_chave ON config_barbearia(chave);

-- =====================================================
-- 4. FUNÇÕES E TRIGGERS
-- =====================================================

-- Função para atualizar timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para timestamps
CREATE TRIGGER update_clientes_updated_at BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_servicos_updated_at BEFORE UPDATE ON servicos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agendamentos_updated_at BEFORE UPDATE ON agendamentos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pagamentos_updated_at BEFORE UPDATE ON pagamentos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inadimplentes_updated_at BEFORE UPDATE ON inadimplentes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_config_updated_at BEFORE UPDATE ON config_barbearia FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Função para verificar conflitos de horário (melhorada)
CREATE OR REPLACE FUNCTION verificar_conflito_horario(
    p_data_horario TIMESTAMP,
    p_horario_inicio TIME,
    p_horario_fim TIME,
    p_agendamento_id INTEGER DEFAULT NULL
)
RETURNS TABLE(
    tem_conflito BOOLEAN,
    agendamento_conflitante INTEGER,
    cliente_conflitante VARCHAR(100),
    horario_conflitante VARCHAR(20)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        TRUE as tem_conflito,
        a.id as agendamento_conflitante,
        c.nome as cliente_conflitante,
        (a.horario_inicio::TEXT || ' - ' || a.horario_fim::TEXT) as horario_conflitante
    FROM agendamentos a
    JOIN clientes c ON a.cliente_id = c.id
    WHERE 
        DATE(a.data_horario) = DATE(p_data_horario)
        AND a.status NOT IN ('cancelado')
        AND (p_agendamento_id IS NULL OR a.id != p_agendamento_id)
        AND (
            (p_horario_inicio >= a.horario_inicio AND p_horario_inicio < a.horario_fim)
            OR (p_horario_fim > a.horario_inicio AND p_horario_fim <= a.horario_fim)
            OR (p_horario_inicio <= a.horario_inicio AND p_horario_fim >= a.horario_fim)
        )
    LIMIT 1;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE as tem_conflito, NULL::INTEGER, NULL::VARCHAR(100), NULL::VARCHAR(20);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Função para atualizar estatísticas do cliente
CREATE OR REPLACE FUNCTION atualizar_estatisticas_cliente()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE clientes SET
            ultimo_agendamento = (
                SELECT MAX(data_horario) 
                FROM agendamentos 
                WHERE cliente_id = NEW.cliente_id
            ),
            total_agendamentos = (
                SELECT COUNT(*) 
                FROM agendamentos 
                WHERE cliente_id = NEW.cliente_id
            ),
            total_gasto = (
                SELECT COALESCE(SUM(p.valor_pago), 0)
                FROM agendamentos a
                JOIN pagamentos p ON a.id = p.agendamento_id
                WHERE a.cliente_id = NEW.cliente_id
                AND p.status_pagamento = 'aprovado'
            )
        WHERE id = NEW.cliente_id;
        RETURN NEW;
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        UPDATE clientes SET
            ultimo_agendamento = (
                SELECT MAX(data_horario) 
                FROM agendamentos 
                WHERE cliente_id = OLD.cliente_id
            ),
            total_agendamentos = (
                SELECT COUNT(*) 
                FROM agendamentos 
                WHERE cliente_id = OLD.cliente_id
            ),
            total_gasto = (
                SELECT COALESCE(SUM(p.valor_pago), 0)
                FROM agendamentos a
                JOIN pagamentos p ON a.id = p.agendamento_id
                WHERE a.cliente_id = OLD.cliente_id
                AND p.status_pagamento = 'aprovado'
            )
        WHERE id = OLD.cliente_id;
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar estatísticas
CREATE TRIGGER trigger_atualizar_estatisticas_cliente
    AFTER INSERT OR UPDATE OR DELETE ON agendamentos
    FOR EACH ROW EXECUTE FUNCTION atualizar_estatisticas_cliente();

-- Função para calcular dias de atraso
CREATE OR REPLACE FUNCTION calcular_dias_atraso(vencimento DATE)
RETURNS INTEGER AS $$
BEGIN
    RETURN GREATEST(0, DATE_PART('day', CURRENT_DATE - vencimento)::INTEGER);
END;
$$ LANGUAGE plpgsql STABLE;

-- Função para atualizar dias de atraso
CREATE OR REPLACE FUNCTION atualizar_dias_atraso()
RETURNS TRIGGER AS $$
BEGIN
    NEW.dias_atraso = calcular_dias_atraso(NEW.data_vencimento);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar dias de atraso
CREATE TRIGGER update_dias_atraso_trigger
    BEFORE INSERT OR UPDATE ON inadimplentes
    FOR EACH ROW EXECUTE FUNCTION atualizar_dias_atraso();

-- =====================================================
-- 5. VIEWS ÚTEIS
-- =====================================================

-- View de agendamentos completos
CREATE VIEW vw_agendamentos_completos AS
SELECT 
    a.id,
    a.data_horario,
    a.horario_inicio,
    a.horario_fim,
    a.status,
    a.preco_cobrado,
    a.observacoes,
    COALESCE(c.nome, 'Cliente Removido') as cliente_nome,
    COALESCE(c.telefone, '') as cliente_telefone,
    COALESCE(s.nome, 'Serviço Removido') as servico_nome,
    COALESCE(s.duracao_minutos, 30) as duracao_minutos,
    COALESCE(SUM(p.valor_pago), 0) as valor_pago,
    (a.preco_cobrado - COALESCE(SUM(p.valor_pago), 0)) as valor_pendente,
    CASE 
        WHEN COALESCE(SUM(p.valor_pago), 0) >= a.preco_cobrado THEN 'pago'
        WHEN COALESCE(SUM(p.valor_pago), 0) > 0 THEN 'parcial'
        ELSE 'pendente'
    END as status_pagamento
FROM agendamentos a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN servicos s ON a.servico_id = s.id
LEFT JOIN pagamentos p ON a.id = p.agendamento_id AND p.status_pagamento = 'aprovado'
GROUP BY a.id, c.id, s.id;

-- View de agendamentos de hoje
CREATE VIEW vw_agendamentos_hoje AS
SELECT * FROM vw_agendamentos_completos
WHERE DATE(data_horario) = CURRENT_DATE
ORDER BY horario_inicio;

-- View de inadimplentes ativos
CREATE VIEW vw_inadimplentes_ativos AS
SELECT 
    i.*,
    calcular_dias_atraso(i.data_vencimento) as dias_atraso_atual,
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
ORDER BY calcular_dias_atraso(i.data_vencimento) DESC;

-- =====================================================
-- 6. DADOS INICIAIS
-- =====================================================

-- Configurações básicas
INSERT INTO config_barbearia (categoria, chave, valor, tipo_valor, descricao) VALUES
('horarios', 'segunda_feira', '08:00-18:00', 'texto', 'Horário de funcionamento na segunda-feira'),
('horarios', 'terca_feira', '08:00-18:00', 'texto', 'Horário de funcionamento na terça-feira'),
('horarios', 'quarta_feira', '08:00-18:00', 'texto', 'Horário de funcionamento na quarta-feira'),
('horarios', 'quinta_feira', '08:00-18:00', 'texto', 'Horário de funcionamento na quinta-feira'),
('horarios', 'sexta_feira', '08:00-18:00', 'texto', 'Horário de funcionamento na sexta-feira'),
('horarios', 'sabado', '08:00-16:00', 'texto', 'Horário de funcionamento no sábado'),
('horarios', 'domingo', 'fechado', 'texto', 'Horário de funcionamento no domingo'),
('geral', 'nome_barbearia', 'Barbearia do Jão', 'texto', 'Nome da barbearia'),
('geral', 'telefone_barbearia', '(11) 99999-9999', 'texto', 'Telefone da barbearia'),
('geral', 'endereco', 'Rua das Flores, 123', 'texto', 'Endereço da barbearia'),
('cobranca', 'dias_para_inadimplencia', '3', 'numero', 'Dias após vencimento para considerar inadimplente'),
('cobranca', 'valor_minimo_cobranca', '10.00', 'numero', 'Valor mínimo para iniciar cobrança'),
('notificacoes', 'lembrete_horas_antes', '24', 'numero', 'Horas antes do agendamento para enviar lembrete');

-- Serviços da barbearia
INSERT INTO servicos (nome, descricao, preco_base, duracao_minutos, categoria) VALUES
('Corte', 'Corte de cabelo tradicional', 30.00, 30, 'corte'),
('Corte Máquina', 'Corte de cabelo com máquina', 25.00, 25, 'corte'),
('Barba', 'Barba completa', 20.00, 20, 'barba'),
('Pezinho', 'Acabamento do pezinho', 15.00, 15, 'acabamento'),
('Sobrancelha', 'Design de sobrancelha', 20.00, 15, 'extras'),
('Relaxamento', 'Relaxamento capilar', 20.00, 45, 'tratamento'),
('Tintura', 'Tintura de cabelo', 20.00, 60, 'tratamento'),
('Luzes', 'Mechas e luzes', 50.00, 90, 'tratamento'),
('Platinado', 'Cabelo platinado', 90.00, 120, 'tratamento');

COMMIT;