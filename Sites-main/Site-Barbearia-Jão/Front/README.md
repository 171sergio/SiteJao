# Barbearia do Jão - Dashboard

Sistema de gerenciamento para barbearia com:
- Dashboard administrativo
- Gestão de agendamentos
- Controle de clientes
- Relatórios financeiros

## Tecnologias
- HTML5
- CSS3
- JavaScript (Vanilla)
- Supabase (Backend as a Service)
- Font Awesome (Ícones)

---

## 🚀 Deploy no Vercel (via GitHub)

### Pré-requisitos
1. Conta no [Vercel](https://vercel.com)
2. Repositório no GitHub com este projeto
3. Projeto no [Supabase](https://supabase.com) com banco configurado

### Passo a passo

1. **No Vercel**, clique em **Add New... > Project**
2. **Importe o repositório** do GitHub (`171sergio/Sites` ou o nome do seu repo)
3. **Configure o Root Directory**:
   - Clique em **Edit** ao lado de "Root Directory"
   - Selecione: `Sites-main/Site-Barbearia-Jão/Front`
4. **Configure as variáveis de ambiente** (Settings > Environment Variables):

   | Nome | Valor | Descrição |
   |------|-------|-----------|
   | `SUPABASE_URL` | `https://SEU_PROJETO.supabase.co` | URL do seu projeto Supabase |
   | `SUPABASE_ANON_KEY` | `eyJ...` | Chave pública (anon) do Supabase |

5. **Clique em Deploy**

O Vercel vai executar `node build-config.js` automaticamente, que gera o `config.js` com suas credenciais.

### Onde encontrar as credenciais do Supabase
1. Acesse [app.supabase.com](https://app.supabase.com)
2. Selecione seu projeto
3. Vá em **Settings > API**
4. Copie:
   - **Project URL** → `SUPABASE_URL`
   - **anon (public)** key → `SUPABASE_ANON_KEY`

> ⚠️ **NUNCA use a chave `service_role`** no frontend — ela dá acesso total ao banco.

---

## 🖥️ Desenvolvimento local

```bash
cd Site-Barbearia-Jão/Front

# Crie config.js manualmente ou execute o build:
# Opção 1: copie config.template.js para config.js e preencha
cp config.template.js config.js

# Opção 2: defina ENV vars e rode o script
export SUPABASE_URL="https://seu-projeto.supabase.co"
export SUPABASE_ANON_KEY="sua-chave-anon"
node build-config.js

# Sirva localmente
npx http-server -c-1 .
# ou
python -m http.server 5500
```

Acesse `http://localhost:8080` (ou a porta indicada).

---

## 📁 Estrutura de arquivos

```
Front/
├── index.html          # Página principal
├── script.js           # Lógica do dashboard
├── styles.css          # Estilos
├── config.js           # (gerado) Configurações do Supabase
├── config.template.js  # Template de configuração
├── build-config.js     # Script que gera config.js no deploy
├── vercel.json         # Configuração do Vercel
└── .gitignore          # Ignora config.js e outros
```

---

## ❓ Troubleshooting

| Problema | Solução |
|----------|---------|
| "Supabase não configurado" | Verifique se as variáveis de ambiente estão corretas no Vercel |
| Erro de CORS | Configure as URLs permitidas no Supabase (Authentication > URL Configuration) |
| Página em branco | Verifique o console do navegador (F12) para erros |
| Deploy falhou | Verifique se o Root Directory está correto: `Sites-main/Site-Barbearia-Jão/Front` |