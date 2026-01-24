# 🤖 Bot Jão Barbeiro - Fluxo n8n

Este documento descreve detalhadamente o funcionamento, estrutura e configuração do fluxo de automação (workflow) do n8n **"Bot Jao Branch Melhoras.json"**.

O bot atua como um assistente virtual para uma barbearia, utilizando Inteligência Artificial (Llama 3.3 via Groq) para agendar, cancelar e consultar horários via WhatsApp, integrado com banco de dados Supabase e API de WhatsApp (Evolution API).

## 📋 Visão Geral

O fluxo recebe mensagens do WhatsApp, verifica se o cliente já está cadastrado, recupera o histórico de conversas e utiliza um Agente de IA para interpretar a intenção do usuário e executar ações no banco de dados (agendamentos).

### Principais Funcionalidades
- **Atendimento Humanizado**: IA com personalidade ("Jão", tom mineiro).
- **Gestão de Clientes**: Cadastro automático de novos clientes.
- **Agendamento Inteligente**: Consulta disponibilidade e realiza agendamentos verificando conflitos.
- **Memória de Contexto**: O bot "lembra" do histórico recente da conversa.
- **Lógica de Retomada**: Identifica se a conversa ficou inativa por mais de 30 minutos para enviar novas saudações.

---

## 🛠️ Estrutura do Fluxo

O workflow é dividido em etapas lógicas principais:

### 1. Entrada e Filtros
- **Webhook**: Ponto de entrada que recebe o JSON da Evolution API a cada nova mensagem.
- **Filtrar Mensagens**: Ignora mensagens enviadas pelo próprio bot (`fromMe: true`) e mensagens de status (`messageType` irrelevantes), evitando loops infinitos.

### 2. Identificação e Cadastro do Cliente
- **Get a row (Supabase)**: Busca na tabela `clientes` pelo número de telefone (`remoteJid`).
- **Lógica de Novo Cliente (If2)**:
  - **Se não existir**: Executa o nó **Registra Cliente** (INSERT no Supabase) e envia uma **Imagem de Boas-vindas** seguida de uma mensagem inicial.
  - **Se existir**: Segue para o fluxo de contexto e atendimento normal.

### 3. Contexto e Memória
- **GeraContexto1**: Busca as últimas mensagens trocadas com este cliente na tabela `logs_atendimento` para fornecer contexto à IA.
- **Log Interação1**: Ao final de cada ciclo, salva a mensagem do usuário e a resposta da IA no banco para manter o histórico.

### 4. O Cérebro (Agente de IA)
O nó **AI Agent** é o núcleo do sistema.
- **Modelo**: `llama-3.3-70b-versatile` (via Groq), escolhido por ser rápido e eficiente.
- **Prompt do Sistema**: Define a persona ("Jão Barbeiro"), regras de negócio (horários de funcionamento), e instruções estritas para usar as ferramentas (Tools) antes de confirmar qualquer ação.

### 5. Ferramentas da IA (Tools)
A IA tem acesso a funções específicas para interagir com o mundo real (neste caso, o banco de dados Supabase):

| Ferramenta | Tipo | Descrição |
| :--- | :--- | :--- |
| **Horários Livres** | RPC (HTTP Request) | Chama a função `listar_horarios_livres` no banco. Usada quando o cliente pergunta disponibilidade. Retorna apenas slots vazios. |
| **Agendar via RPC** | RPC (HTTP Request) | Chama `realizar_agendamento_seguro`. Tenta inserir o agendamento; o banco valida conflitos e retorna sucesso ou erro. **Atomicidade garantida pelo banco.** |
| **Editar Agendamento** | Supabase Tool | Permite alterar data, hora ou serviço de um agendamento existente (`UPDATE`). |
| **Cancelar Agendamento** | Supabase Tool | Marca um agendamento como cancelado (`UPDATE status`). |
| **Serviços** | Supabase Tool | Consulta a lista de serviços e preços (`SELECT`). |

### 6. Saída (Envio de Mensagem)
- **Verifica Última Interação**: Um script JavaScript calcula quanto tempo passou desde a última conversa. Se > 30 min, pode acionar um fluxo diferente (ex: re-saudação).
- **Evolution API (Send Text/Image)**: Envia a resposta final gerada pela IA para o WhatsApp do cliente.

---

## ⚙️ Pré-requisitos e Configuração

Para rodar este fluxo, você precisa de:

### 1. n8n
- Instância do n8n rodando (Self-hosted ou Cloud).

### 2. Supabase (Banco de Dados)
O projeto deve ter as seguintes tabelas criadas:
- `clientes` (id, nome, telefone, ...)
- `agendamentos` (id, cliente_id, data_horario, status, ...)
- `servicos` (id, nome, preco, ...)
- `logs_atendimento` (id, telefone, mensagem, resposta_ia, timestamp, ...)

E as funções RPC (Stored Procedures):
- `listar_horarios_livres(data)`
- `realizar_agendamento_seguro(...)`

### 3. Evolution API (WhatsApp)
- Uma instância da [Evolution API](https://github.com/EvolutionAPI/evolution-api) conectada a um número de WhatsApp.
- Configurar o Webhook da Evolution para apontar para a URL do Webhook do n8n.

### 4. Credenciais no n8n
Você precisará cadastrar as seguintes credenciais no n8n:
- **Supabase API**: URL e Key (Service Role ou Anon, dependendo da permissão necessária, geralmente Service Role para o n8n).
- **Groq API**: API Key da Groq para usar o modelo Llama.
- **Evolution API**: URL da instância e API Key Global.

---

## 💡 Melhorias Sugeridas (Feature Request: Bot Pause)

O fluxo atual **não possui** um botão explícito para "Pausar o Bot" caso um humano queira assumir. O nó "Verifica Última Interação" apenas gerencia o tempo de sessão.

Para implementar a Função de Pausa (Atendimento Humano):

1.  **No Banco de Dados**:
    - Adicionar uma coluna `bot_ativo` (boolean, default true) na tabela `clientes`.
2.  **No Fluxo n8n**:
    - Logo após o Webhook, adicionar um nó **Supabase Get** para ler o status `bot_ativo` desse cliente.
    - Adicionar um nó **IF**:
      - Se `bot_ativo == true`: Segue o fluxo normal para a IA.
      - Se `bot_ativo == false`: Encerra o fluxo imediatamente (não responde nada), permitindo que o humano responda pelo celular.
3.  **Interface de Controle**:
    - Criar um comando no próprio WhatsApp (ex: admin enviar `/pausar 55319...`) que atualiza essa coluna no banco.
    - Ou criar um painel simples (Appsmith/Retool/Página Web) para ligar/desligar o bot por cliente.

---

## 🚀 Como Importar
1. No n8n, clique em "Add Workflow".
2. Selecione "Import from File".
3. Escolha o arquivo `Bot Jao Branch Melhoras.json`.
4. Configure as Credenciais nos nós que apresentarem erro.
5. Ative o workflow.
