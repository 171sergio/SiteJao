# SiteJao

**Visão Geral**
- **Descrição:** Projeto de site e fluxo de agendamento para Barbearia Jão. Contém código do front-end (site), scripts/seed para o banco (Supabase) e fluxos de automação/assistente (n8n).

**Estrutura do Repositório**
- `Site-Barbearia-Jão/Front/`: arquivos públicos do site (`index.html`, `script.js`, `styles.css`, `config.js`).
- `Site-Barbearia-Jão/Back/`: scripts SQL e arquivos de configuração/seed para o banco (`setup_banco_supabase.sql`, `reserva.json`, etc.).
- `Bot-BarbeariaJao.json` / `Back/Bot_Atendente_Agendamento.json`: export do fluxo n8n usado como assistente/atendente.

**Banco de Dados (Supabase)**
- **Propósito:** armazenar serviços, preços, durações, reservas e configurações da barbearia. Serve como fonte única de verdade (SOT) para front e bot.
- **Arquivos relevantes:** `Site-Barbearia-Jão/Back/setup_banco_supabase.sql` (cria tabelas e seeds). Consulte também `BANCO_FINAL_UNICO.sql` se presente no repositório.
- **Tabelas importantes:**
	- `servicos`: lista de serviços oferecidos (nome, preço, duração, id).
	- `config_barbearia`: configurações gerais (horários de funcionamento, políticas, intervalos de agendamento).
- **Boas práticas:** não manter preços/horários hardcoded nos prompts do bot; sempre consultar o banco em tempo de execução.

**Fluxo n8n (Automação / Assistente)**
- **Propósito:** orquestrar mensagens, verificar disponibilidade, criar reservas e chamar o modelo de IA quando necessário.
- **Arquivos/Export:** `Bot-BarbeariaJao.json` e `Site-Barbearia-Jão/Back/Bot_Atendente_Agendamento.json` — podem ser importados no n8n.
- **Integração recomendada com Supabase:**
	- Antes de enviar o prompt para o nó de IA, adicione um node que consulte `servicos` e `config_barbearia` no Supabase.
	- Envie o resultado como contexto JSON para o nó de IA (ex.: `context.servicos = [...]`, `context.config = {...}`) e mantenha o prompt humano legível e curto.
- **Porque evitar hardcoding no prompt:** evita drift de dados, reduz tokens usados e garante respostas consistentes quando preços/horários mudam.

**Front-end (Site)**
- **Propósito:** interface de agendamento e apresentação dos serviços.
- **Arquivos principais:**
	- `Site-Barbearia-Jão/Front/index.html` — página estática principal.
	- `Site-Barbearia-Jão/Front/script.js` — carrega serviços do banco (ou arquivo local em ambientes de teste) e popula selects/formulários.
	- `Site-Barbearia-Jão/Front/config.js` — configurações runtime (endpoints, chaves públicas para uso cliente quando aplicável).
- **Execução local:** abrir `index.html` no navegador ou servir com um servidor estático (ex.: `npx http-server` ou `python -m http.server`).

**Como rodar / testar localmente**
- Servir front estático (ex.: no PowerShell):
	```powershell
	cd "Sites-main/Site-Barbearia-Jão/Front"
	npx http-server -c-1 .
	# ou
	python -m http.server 5500
	```
- Importar o fluxo no n8n: abrir n8n -> Import -> colar JSON de `Bot-BarbeariaJao.json` ou `Back/Bot_Atendente_Agendamento.json`.
- Criar projeto no Supabase e rodar `Site-Barbearia-Jão/Back/setup_banco_supabase.sql` para criar tabelas e seeds.

**Como publicar no GitHub (resumo rápido)**
- Se ainda não criou o repositório remoto, crie pelo site do GitHub ou usando a CLI `gh`:
	```bash
	cd "C:\Users\Sergio\Desktop\iaJao"
	gh auth login
	gh repo create SiteJao --public --source=. --remote=origin --push
	```
- Alternativa manual:
	```bash
	cd "C:\Users\Sergio\Desktop\iaJao"
	git init
	git add .
	git commit -m "Initial commit"
	git remote add origin https://github.com/171sergio/Sites.git
	git push -u origin main
	```

**Segurança / Notas importantes**
- Nunca comite chaves privadas ou `service_role` do Supabase. Use variáveis de ambiente e arquivos locais no `.gitignore` (`.env`, `credentials.json`).
- Se já cometeu credenciais, revogue-as no painel do provedor e gere novas.

**Dicas de melhoria (rápidas)**
- Mudar o fluxo n8n para sempre consultar Supabase e injetar contexto dinâmico no nó de IA.
- Adicionar rotinas de validação de reservas (verificar conflitos por horário/serviço).
- Adicionar README por módulo (ex.: `Front/README.md`, `Back/README.md`, `n8n/README.md`) se desejar documentação separada.

---
Se quiser, eu:
- atualizo `README.md` com exemplos de queries SQL para `servicos`/`config_barbearia`;
- gero um `.gitignore` e um README mais detalhado para o `Front` e o `Back`.
Diga qual dessas ações quer que eu faça em seguida.