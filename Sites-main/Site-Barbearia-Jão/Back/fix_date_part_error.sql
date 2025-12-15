-- =====================================================
-- CORREÇÃO DO ERRO EXTRACT/DATE_PART
-- Execute este script no Supabase para corrigir o erro
-- =====================================================

-- Remover trigger problemático temporariamente
DROP TRIGGER IF EXISTS update_dias_atraso_trigger ON inadimplentes;

-- Corrigir a função calcular_dias_atraso
CREATE OR REPLACE FUNCTION calcular_dias_atraso(vencimento DATE)
RETURNS INTEGER AS $$
BEGIN
    -- Verificar se a data de vencimento é válida
    IF vencimento IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Calcular diferença em dias - se positivo, está em atraso
    -- Se negativo ou zero, não está em atraso
    IF CURRENT_DATE > vencimento THEN
        RETURN (CURRENT_DATE - vencimento)::INTEGER;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Corrigir a função atualizar_dias_atraso
CREATE OR REPLACE FUNCTION atualizar_dias_atraso()
RETURNS TRIGGER AS $$
BEGIN
    -- Calcular dias de atraso apenas se data_vencimento não for nula
    IF NEW.data_vencimento IS NOT NULL THEN
        NEW.dias_atraso = calcular_dias_atraso(NEW.data_vencimento);
    ELSE
        NEW.dias_atraso = 0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recriar o trigger
CREATE TRIGGER update_dias_atraso_trigger
    BEFORE INSERT OR UPDATE ON inadimplentes
    FOR EACH ROW EXECUTE FUNCTION atualizar_dias_atraso();

-- Atualizar registros existentes (se houver)
UPDATE inadimplentes 
SET dias_atraso = calcular_dias_atraso(data_vencimento)
WHERE data_vencimento IS NOT NULL;

-- Verificar se a correção funcionou
SELECT 'Correção aplicada com sucesso!' as status;