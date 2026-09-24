# Spec Kit — Business Automation

## Objetivo
Automação de processos empresariais com workflows versionáveis, execução controlada, histórico e conectores seguros.

## Estado atual
- Workflows com steps e estado enabled/paused
- Execução manual com idempotency key
- Histórico e analytics
- Drill-down e exportação CSV
- Ações rápidas no dashboard
- Redação de dados sensíveis em execução/histórico
- Autenticação, perfil, notificações e atividade
- Deploy de produção validado

## Critérios de qualidade
- Ownership obrigatório por usuário
- Validação de steps e configurações
- Limites de steps, concorrência e execução diária
- Idempotência em execuções manuais
- Nunca persistir saída sensível sem redação

## Próximas evoluções
1. Versionamento de workflow
2. Retry com backoff e dead-letter
3. Conectores externos com secrets isolados
4. Auditoria completa de alterações
5. Testes automatizados de execução e segurança
