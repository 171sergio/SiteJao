-- Script para corrigir agendamentos com status 'nao_compareceu'
-- Este script deve ser executado no Supabase para corrigir dados existentes

-- 1. Atualizar todos os agendamentos com status 'nao_compareceu' para 'concluido'
UPDATE agendamentos 
SET status = 'concluido', 
    atualizado_em = CURRENT_TIMESTAMP
WHERE status = 'nao_compareceu';

-- 2. Verificar se a atualização foi bem-sucedida
SELECT 
    COUNT(*) as total_atualizados
FROM agendamentos 
WHERE status = 'concluido' 
    AND atualizado_em >= CURRENT_TIMESTAMP - INTERVAL '1 minute';

-- 3. Verificar se ainda existem agendamentos com status 'nao_compareceu'
SELECT 
    COUNT(*) as restantes_nao_compareceu
FROM agendamentos 
WHERE status = 'nao_compareceu';

-- 4. Atualizar o constraint da tabela para remover 'nao_compareceu' (se necessário)
-- NOTA: Este comando só deve ser executado se a tabela já existir no banco
-- ALTER TABLE agendamentos DROP CONSTRAINT IF EXISTS agendamentos_status_check;
-- ALTER TABLE agendamentos ADD CONSTRAINT agendamentos_status_check 
--     CHECK (status IN ('agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado'));

SELECT 'Script de correção executado com sucesso!' as resultado;