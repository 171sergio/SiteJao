# Barbearia do Jão — SQL otimizado + instruções de deploy

Este repositório contém:
- `banco_otimizado_final.sql` — esquema SQL compatível com o bot (n8n) e com o site.
- Front-end em `Sites-main/Site-Barbearia-Jão/Front`.

Objetivo
--------
Permitir que o bot do n8n insira/edite/cancele agendamentos sem ser bloqueado por restrições relacionais, mantendo integridade para o site.

Testes rápidos (no Supabase SQL editor)
---------------------------------------
1) Inserir exemplo (simula n8n):
```sql
INSERT INTO agendamentos (telefone, nome_cliente, servico, data_horario, horario_inicio, horario_fim, preco, status)
VALUES ('5511999999999', 'Teste Bot', 'Corte', '2025-12-10 14:00:00', '14:00', '14:30', 30.00, 'agendado');
```

2) Verificar agendamento:
```sql
SELECT * FROM agendamentos WHERE telefone = '5511999999999' ORDER BY criado_em DESC LIMIT 1;
```

3) Verificar cliente criado/associado:
```sql
SELECT * FROM clientes WHERE telefone = '5511999999999';
```

4) Verificar triggers existem:
```sql
SELECT tgname FROM pg_trigger WHERE tgrelid = 'agendamentos'::regclass;
```

Observações importantes
-----------------------
- Triggers não bloqueiam inserts — se falhar a criação/associação tenta seguir em frente.
- Se o nome do serviço enviado pelo bot não bater exatamente com `servicos.nome`, `servico_id` ficará NULL — intencional.
- `cliente_id` e `servico_id` são NULLABLE para compatibilidade com fluxo do n8n.

Review do Front
---------------
Local: `Sites-main/Site-Barbearia-Jão/Front`

Principais arquivos:
- `index.html` — página estática.
- `script.js` — lógica que consome Supabase e faz CRUD.
- `config.js` — ponto para inserir `SUPABASE_CONFIG`.

Atenção para o deploy
---------------------
- Nunca deixe chaves `service_role` no front. Use apenas `anonKey` no navegador.
- Se o front precisa realizar operações administrativas (ex.: apagar, executar triggers sensíveis), mova para backend ou use n8n ou funções serverless.

Deploy local (teste rápido)
---------------------------
Na pasta `Sites-main/Site-Barbearia-Jão/Front` rode (PowerShell):
```powershell
python -m http.server 3000
# ou
npx serve . -l 3000
```
Acesse: http://localhost:3000

Deploy Vercel (recomendado para produção)
-----------------------------------------
1. Instale CLI: `npm i -g vercel`
2. Faça login: `vercel login`
3. No diretório `Sites-main/Site-Barbearia-Jão/Front` rode: `vercel --prod`

Próximos passos executados
--------------------------
- Criei `banco_otimizado_final.sql` (schema final).
- Criei este `README-deploy-e-uso.md`.
- Próximo: revisar `script.js` e `config.js` para garantir compatibilidade com os nomes de campos do DB.

Se quiser, posso agora:
- Ajustar `script.js` para usar exatamente os campos do novo schema (`telefone`, `nome_cliente`, `servico`, `data_horario`, `horario_inicio`, `horario_fim`, `preco`, `status`).
- Rodar um servidor local aqui no workspace para testar o front (não publica na internet).

Diga qual ação você quer agora.