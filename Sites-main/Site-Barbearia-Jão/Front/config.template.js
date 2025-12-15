// TEMPLATE: config.template.js
// Copie este arquivo para `config.js` e preencha as variáveis ou
// configure variáveis de ambiente no Vercel e substitua em build.

// Exemplo de uso (preenchido):
// const SUPABASE_CONFIG = { url: 'https://xyz.supabase.co', anonKey: 'PUBLIC_ANON_KEY' };

const SUPABASE_CONFIG = {
  url: 'YOUR_SUPABASE_URL_HERE',
  anonKey: 'YOUR_PUBLIC_ANON_KEY_HERE'
};

export default SUPABASE_CONFIG;

/*
  Instruções de deploy:
  - No Vercel: Project > Settings > Environment Variables
    crie `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ou nomes que preferir).
  - Durante a build, gere um arquivo `config.js` a partir dessas ENV vars (se usar um bundler),
    ou substitua manualmente antes do deploy.

  ATENÇÃO: nunca exponha `service_role` no frontend.
*/
