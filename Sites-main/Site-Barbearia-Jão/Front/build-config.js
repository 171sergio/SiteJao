/**
 * build-config.js
 * 
 * Script de build para Vercel: gera config.js a partir de variáveis de ambiente.
 * Executado automaticamente pelo Vercel durante o deploy.
 * 
 * VARIÁVEIS DE AMBIENTE NECESSÁRIAS NO VERCEL:
 *   - SUPABASE_URL       (ex: https://xyzcompany.supabase.co)
 *   - SUPABASE_ANON_KEY  (sua chave pública/anon do Supabase)
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Validação
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('⚠️  AVISO: Variáveis SUPABASE_URL ou SUPABASE_ANON_KEY não definidas.');
  console.warn('   O site pode não funcionar corretamente sem elas.');
  console.warn('   Configure em: Vercel > Project Settings > Environment Variables');
}

const configContent = `// config.js - GERADO AUTOMATICAMENTE PELO BUILD
// NÃO EDITE ESTE ARQUIVO MANUALMENTE EM PRODUÇÃO
// Configure as variáveis de ambiente no Vercel:
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY

const SUPABASE_CONFIG = {
    url: '${SUPABASE_URL}',
    anonKey: '${SUPABASE_ANON_KEY}'
};
`;

const outputPath = path.join(__dirname, 'config.js');

try {
  fs.writeFileSync(outputPath, configContent, 'utf8');
  console.log('✅ config.js gerado com sucesso!');
  console.log(`   SUPABASE_URL: ${SUPABASE_URL ? '✓ definida' : '✗ NÃO DEFINIDA'}`);
  console.log(`   SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY ? '✓ definida' : '✗ NÃO DEFINIDA'}`);
} catch (err) {
  console.error('❌ Erro ao gerar config.js:', err.message);
  process.exit(1);
}
