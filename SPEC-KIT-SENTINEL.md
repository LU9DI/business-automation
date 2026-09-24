# Sentinel AI — Spec Kit

## Objetivo
Plataforma de inteligência assistida por IA para correlacionar dados autorizados, eventos e vínculos, apoiar investigações e produzir alertas explicáveis para revisão humana.

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
