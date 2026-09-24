# Horus — Intelligence OS Spec Kit

## Objetivo
Horus é uma plataforma de inteligência assistida por IA para correlacionar dados autorizados, eventos e vínculos, apoiar investigações e produzir alertas explicáveis para revisão humana.

## Princípios
- Assistência, não decisão automatizada.
- Nenhum alerta é prova de crime, lavagem de dinheiro ou irregularidade.
- Finalidade, necessidade, proporcionalidade e controle de acesso.
- Dados reais somente mediante autorização e base jurídica adequada.
- Dataset sintético para demonstrações e desenvolvimento.
- Auditoria de consultas, análises e alterações.
- Separação por tenant e princípio do menor privilégio.
- Versionamento dos algoritmos e rastreabilidade dos resultados.

## Módulos implementados
- Dashboard web completo em `/sentinel` com visão geral, KPIs, alertas e workspace responsivo.
- Grafo visual interativo com arraste, zoom, busca e inspeção de entidades.
- Timeline de eventos com ordenação temporal e origem.
- AI Analyst evidence-grounded com pergunta livre, evidências, versão e revisão humana.
- Importação sintética JSON/CSV limitada a 200 registros por lote, com proveniência.
- Biblioteca de cenários demonstrativos sintéticos executáveis.
- Grafo de entidades e relacionamentos.
- Eventos financeiros/operacionais.
- Alertas explicáveis.
- Casos investigativos.
- Associação de entidades a casos.
- Execuções de análise versionadas.
- Trilha de auditoria.
- Fontes de dados com classificação.
- Dataset sintético.
- API autenticada.

### Graph Engine v1
- visualização baseada nas relações reais retornadas por `/api/sentinel/graph`;
- rótulos de relacionamento, tamanho proporcional ao grau e seleção de entidade;
- exploração de caminho de até cinco saltos;
- drawer de evidências da entidade com relações, eventos e alertas relacionados;
- visualização preparada para expansão multi-hop sem transformar conexões em conclusões;
- grafo contextual por caso com profundidade 1–3 e destaque das entidades do caso.

### Investigation Workspace v1
- abertura de casos diretamente pelo dashboard;
- visão contextual de entidades, alertas, análises e auditoria;
- grafo contextual e timeline filtrável diretamente no Evidence Center.
- vínculo de entidades ao caso com papel explícito;
- execução de análise registrada no caso;
- evidência e governança apresentadas no mesmo workspace;
- nenhum resultado do workspace constitui conclusão automática sobre pessoas ou organizações.

### Implementado — Investigation Intelligence v2
- Grafo contextual por caso com profundidade configurável de 1–3 saltos, limite de nós/arestas e destaque das entidades-semente.
- Timeline filtrável por período, tipo de evento e entidade, com contagem/valor agregado do recorte.
- Metadados de versão do algoritmo e revisão humana obrigatória nas novas análises.
- Busca global corrigida para preservar curingas SQL como dados e manter isolamento por tenant.

### Investigation Intelligence v3 — Rule Lab
- Motor de regras configuráveis por workspace com tipos versionados: conectividade, frequência/burst temporal, limiar de valor e atributo compartilhado.
- Cada regra possui versão, severidade, definição JSONB, estado habilitado/desabilitado e trilha de auditoria.
- Avaliação gera somente sinais assistivos, com rationale, evidências, algoritmo `horus-rules-v1` e `humanReviewRequired=true`.
- Deduplicação impede repetição de sinais abertos/revisando para a mesma regra e evidência principal.
- Índices compostos foram preparados para entidades, relações, eventos, alertas, casos, auditoria, análises e regras.
- O Rule Lab da interface permite criar, ativar/desativar e executar regras sem transformar o mecanismo em decisão automatizada.

### Investigation Intelligence v4 — Correlation Engine
- Correlação contextual por caso entre sinais, eventos e relacionamentos.
- Janela temporal configurável de 1–720 horas e limite de resultados controlado.
- Detecção de sequências temporais, interseções evento↔relacionamento e sobreposição sinal↔entidade.
- Cada correlação retorna evidências referenciáveis, justificativa e relevância técnica limitada a ordenação/visualização.
- horus-correlation-v2, humanReviewRequired=true, registro em sentinel_analysis_runs e auditoria da execução.
- A interface do Evidence Center expõe o Correlation Explorer sem converter relevância técnica em probabilidade ou conclusão investigativa.

## Próximas fases
1. UI própria do Sentinel.
2. Visualização de grafo e timeline.
3. Importadores CSV/JSON com validação e proveniência.
4. Regras configuráveis e biblioteca de cenários.
5. Busca full-text e busca por múltiplos vínculos.
6. RBAC avançado, MFA e segregação de funções.
7. Retenção, criptografia e gestão de chaves.
8. Testes de segurança, carga e isolamento multi-tenant.
9. Conectores somente após validação jurídica/técnica.
10. Piloto com dados sintéticos e critérios de aceitação.
11. Pacote B2G: arquitetura, segurança, LGPD, SLA, treinamento e documentação de contratação.
12. Módulo privado de compliance/AML separado logicamente do módulo de investigação pública.

## Critérios de aceitação do MVP
- Nenhuma consulta cruza tenants.
- Toda análise gera registro auditável.
- Toda saída de IA/ruleset exibe versão e necessidade de revisão humana.
- Dados sintéticos são marcados como sintéticos.
- O sistema consegue reconstruir por que um alerta foi criado.
- APIs rejeitam entidades fora do workspace.
- Limites de paginação e payload são aplicados.
- Nenhum modelo toma decisão de prisão, abordagem, bloqueio de conta ou atribuição de culpa.

## Nota regulatória
Para segurança pública e investigação penal, a arquitetura deve ser submetida à análise jurídica e de proteção de dados antes de qualquer uso com dados pessoais reais. A LGPD possui tratamento específico para essas finalidades e prevê requisitos adicionais para atuação de entidades privadas.
