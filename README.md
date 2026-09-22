# Business Automation

Automação para pequenos negócios com workflows, IA, integrações e tarefas recorrentes.

## Arquitetura
- Repositório independente
- Backend Node.js + TypeScript + Express
- PostgreSQL próprio por produto
- Autenticação JWT com rotação de segredos
- Segurança, métricas e retry desacoplados do domínio
- Frontend e deployment próprios

## Isolamento
Este projeto não depende do runtime, banco, domínio, rotas ou regras de negócio do Filtra.AI. Componentes genéricos foram reproduzidos/adaptados como fundação independente.

## Próximas camadas
1. domínio específico
2. API e persistência
3. frontend
4. integrações de IA/pagamentos quando aplicável
5. testes e CI
6. deployment independente
