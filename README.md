# QuestVTT

**Virtual Tabletop de código aberto, auto-hospedado e leve, inspirado no Foundry VTT.**
Roda no PC do Mestre (Windows, Linux ou macOS); os jogadores entram só pelo navegador, pela rede local ou pelo **Radmin VPN**.
Vem com o sistema **DuskBloods** (horror cósmico vitoriano, pool de D6) e foi feito para receber outros sistemas de RPG como módulos.

> Guia de instalação para leigos, passo a passo: **[LEIA-ME-REDE.md](LEIA-ME-REDE.md)**.

---

## Início rápido

```bash
npm install
npm start          # ou dois cliques em INICIAR.bat no Windows
```

Abra `http://localhost:3000`, entre com o `gmName` e a `gmPassword` do `config.json` (**troque a senha padrão**).
O terminal mostra os endereços de **Rede local** e **Radmin VPN** (IP `26.x.x.x`) para passar aos jogadores.

Requisitos: Node.js 22.13 ou mais novo (22 LTS, 24...). O banco usa o SQLite embutido no Node, então a instalação não compila nada (não precisa de Python nem de Visual Studio).

## O que tem na mesa

| Área | Recursos |
|---|---|
| **Entrada** | Mestre, jogador e espectador. Senha da mesa opcional, senha pessoal por jogador (bcrypt), aprovação de novos jogadores pelo Mestre, jogadores online com cor própria, reconexão automática. |
| **Mapa** (PixiJS v8, WebGL) | Imagem de fundo, grade quadrada ajustável, zoom e arrasto, tokens com retrato, barras de Vida/Guarda e ícones de estado, régua em metros, ping, alvos (tecla **T**), arrastar fichas e criaturas do bestiário para o mapa. |
| **Atmosfera** | Paredes e portas que bloqueiam visão e movimento, luzes com raio e cor que tremulam, **escuridão por padrão**, névoa de guerra pintada pelo Mestre, música e ambiente sincronizados (várias faixas ao mesmo tempo, volume individual), handouts em tela cheia, efeitos de Dementia na tela do jogador. |
| **Chat** | `/r`, `/gm` (oculta), `/w` (sussurro), `/me`, `/tabela` e os comandos do sistema (`/teste`, `/sanidade`, `/ataque`, `/pool`, `/dano`, `/velas`). Rolagens mostram cada dado; sucessos em vermelho-sangue. |
| **Combate** | Rastreador por lados (caçadores → criaturas), rodada, PA de cada combatente, token ativo, iniciativa pela regra do sistema, estados com duração e dano contínuo automáticos. |
| **Fichas** | Ficha do caçador e da criatura lidas das regras em JSON; clique no atributo/perícia rola direto; importar/exportar em JSON. |
| **Compêndio** | Navegável e pesquisável; arraste para a ficha ou (bestiário) para o mapa. |
| **Diário** | Páginas de lore, notas ocultas do Mestre, notas compartilhadas editáveis, visibilidade por jogador, "mostrar a todos". |
| **Tabelas** | Tabelas do sistema (encontros, mutações, rumores, achados) e tabelas criadas pelo Mestre. |
| **Cenas** | Várias cenas, trocar a cena de todos com um clique, o Mestre pode "espiar" a próxima (os jogadores pré-carregam o mapa), exportar/importar em JSON. |
| **Dados** | Tudo salvo em SQLite (`data/questvtt.db`), backup automático em `data/backups` ao iniciar, a cada 30 min e ao encerrar. |

### Segurança

O servidor é a autoridade: **toda rolagem acontece no servidor** e todo evento valida a permissão antes de ser retransmitido (o jogador só vê e edita a própria ficha, só move os próprios tokens e não recebe tokens ocultos, notas do Mestre nem rolagens ocultas). Uploads têm limite de tamanho, lista branca de extensões e checagem do conteúdo do arquivo; nenhum endpoint executa código.

## Estrutura

```
PROJETO-QUESTVTT/
├─ INICIAR.bat / LIBERAR-FIREWALL.bat / config.json
├─ server/                 núcleo do VTT (não sabe nada de DuskBloods)
│  ├─ index.js             Express + Socket.IO
│  ├─ db.js / store.js     SQLite embutido do Node (node:sqlite) com migrações
│  ├─ auth.js              login, sessões, papéis
│  ├─ world.js             permissões e difusão filtrada por usuário
│  ├─ systems.js           carrega sistemas de jogo (regras + compêndio + motor)
│  └─ sockets/             chat, cenas/tokens/paredes/luzes/névoa, fichas, combate, áudio, diário
├─ systems/
│  └─ duskbloods/
│     ├─ system.json
│     ├─ rules/*.json      ← REGRAS (edite aqui para balancear)
│     ├─ compendium/*.json ← armas, Arcanos, Marcas, talentos, mutações, itens, bestiário...
│     ├─ server/           motor que LÊ e APLICA as regras
│     └─ client/           ficha, diálogos, cartões do chat
├─ public/                 interface (HTML + CSS + JS puro com ES Modules)
├─ data/                   banco, uploads e backups (criados ao rodar)
└─ test/                   testes automatizados (npm test)
```

## Balancear o jogo sem programar

Todas as regras do DuskBloods estão em `systems/duskbloods/rules/` e `systems/duskbloods/compendium/`.
**Salve o arquivo e a mesa recarrega sozinha** (se o JSON tiver erro, a mesa mantém as regras antigas e avisa o Mestre).
Também há o botão **↻ Recarregar regras** na aba ⚙.

| Arquivo | Conteúdo |
|---|---|
| `rules/core.json` | Face mínima de sucesso (5), explosão no 6, Falha Crítica, excedentes do Sucesso Crítico (4), dificuldades. |
| `rules/attributes.json` | 5 atributos, 15 perícias, proficiência, pontos de criação. |
| `rules/classes.json` | Vida, Guarda, perícia de classe, Academias, Espaços de Magia e passivas das 5 classes. |
| `rules/combat.json` | PA (6 por turno, máx. 8), Limiar base, custos de ataque, Gatilho, Visceral, Contra-Tiro, defesas, Guarda, ações, tiers de criaturas, fases de Chefe, velas. |
| `rules/states.json` | Todos os estados: ícone, duração, dano contínuo e efeitos automáticos. |
| `rules/dementia.json` | Estágios, mutações por estágio, dificuldades de Sanidade, sussurros da tela. |
| `rules/humanitas.json`, `rules/discernment.json`, `rules/between.json` | Humanitas, marcos de Discernimento, Reforço, descanso, morte, kit inicial, carga. |
| `rules/damage-types.json` | Os 9 tipos de dano, Fraqueza (+1d6) e Resistência (metade). |

Exemplo: para que o sucesso seja 4+, mude `"successMin": 5` para `4` em `rules/core.json`.

## O motor do DuskBloods (o que é automático)

- **Pool de D6**: Atributo + Perícia; 5 e 6 são sucessos; 6 explode; Falha Crítica ao rolar de novo os 1.
- **Limiar Universal**: ninguém rola defesa; o ataque acerta se os sucessos igualarem o Limiar (base 3 + ação defensiva + forma que defende + cobertura + estados).
- **Dano**: Dano Base (multiplicado no Crítico e no Visceral) + Excedentes + fixos que **nunca multiplicam** (Dano de Truque, Ataque Pesado +2, Reforço da Oficina, revestimentos, Fraqueza +1d6), Resistência pela metade, Redução de Dano (ignorada por dano Massivo). O cartão do chat mostra cada parte separada.
- **TOC**: botão *Transformar* (livre fora de combate); em combate a troca vai junto do Ataque Básico (+1 PA). Forma de Duas Mãos guarda automaticamente o revólver/Canalizador da mão livre; sacar de novo custa 1 PA. Ataque Pesado nunca acompanha a troca. Martelo-Machadinha Gêmea dá desconto de PA no segundo ataque; efeitos de cada arma (Exsanguis da Serra, +2 Limiar do Escudo-Lâmina, Fulguratio do Martelo Galvânico etc.) vêm do JSON.
- **Contra-Tiro**: quando uma criatura ataca um caçador com revólver em mãos e PA guardado suficiente, **o jogador recebe um aviso com botão de reação** (o Mestre também vê e pode decidir por um jogador offline). Acertou: golpe cancelado, a criatura entra em **Fractura** e perde o PA. Venatûrnus paga 3 PA.
- **Guarda e Fractura**, **Ataque Visceral** (limite de 2 por criatura), **desestabilizar** do Ataque Pesado, **estados** com duração e dano contínuo no início do turno, **Arcanos** (Canalizador em mãos, Espaços de Magia, Regra Magicka, custos em Frasco/Vida/Dementia), **Marcas** (descontam o material do inventário), **Sanidade** com ganho automático de Dementia, estágios e aviso de mutação, **marcos de Discernimento**, **Morrendo e as velas**, **morte** com +5 Dementia e **marcador de cadáver com os Ecos** no mapa, **descanso**, **fases de Chefe** (Postura Elevada).

Estados aplicados por criaturas em caçadores aparecem no cartão com o botão **Resistir** (o caçador rola, como manda o livro).

## De onde vieram as regras

Os campos marcados como `[PREENCHER]` no pedido original foram preenchidos a partir do **DuskBloods — Livro Base**. Onde o pedido e o livro divergiam, **segui o livro** (é possível trocar nos JSON):

| Tema | Pedido | Livro (usado) |
|---|---|---|
| Limiar das criaturas | Fraco 2, Padrão 3-4, Elite 5-6, Chefe 7+ | Fraca 1, Padrão 2, Elite 3, Chefe 3, Ascendente 5+ (Chefe ganha +1 por 2 turnos na fase 2) |
| Classes marciais | "só Marcas" | acessam **uma** Academia com 2 Espaços (Cruentâris→Thumeria, Venatûrnus→Mornvein, Noctivus→Byerghwaith) |
| Rolagem de Thumeria | Vigor + Resistência | Vigor + **Instinto** |
| Perícia "Resistência" | — | chama-se **Resiliência** (o comando `/teste Vigor+Resistência` também funciona) |
| Iniciativa | [PREENCHER] | por lados; um caçador rola Percepção + Investigação (Normal); surpresa decide direto |
| PA | [PREENCHER] | 6 por turno, máximo 8 (11 com Adrenalina) |

**Interpretações do VTT** (configuráveis ou fáceis de mudar):
- *Falha Crítica*: exige ao menos um novo 1 ao rolar de novo os 1 (`criticalFailure.requireNewOne` em `core.json`).
- Na **rodada 1** todos começam com 6 PA; a recuperação de 6 começa a partir da rodada 2 (como no exemplo de rodada do livro).
- "Até o fim do próximo turno do alvo" = o estado dura até o fim do próximo turno do lado dele.
- Ataques em área **não** oferecem Contra-Tiro (um único disparo não interrompe vários golpes).
- Fraqueza soma +1d6 uma vez por tipo de dano presente no golpe.

**Fica a cargo do Mestre** (o cartão ou a ficha lembra, mas não automatiza): Interpor-se (redirecionar o alvo), Agarrar, ataques de oportunidade (há a opção "oportunidade" no ataque da criatura), divisão de dano do Communio Sanguinis, Frasco de Piche, Armadilha de Ferro, Isca/Seixo/Última Vela, a maior parte dos Talentos sem número (Masoquista, Vivendo no Limite, Paciência do Atirador...), alcance máximo das armas (o VTT mede e avisa em alguns casos), penalidades de carga (só exibidas).

## Um segundo RPG (outros sistemas)

O núcleo não conhece nenhuma regra: ele carrega o sistema indicado em `config.json → "system"`. Para criar outro:

1. Copie `systems/duskbloods` para `systems/<meu-sistema>` e ajuste o `system.json` (id, tipos de ficha, arquivos de regras e compêndio).
2. `server/engine.js` exporta `createEngine(ctx)` com: `defaultActorData`, `sanitizeUpdate`, `publicActorData`, `decorate`, `commands` (comandos do chat), `registerSocket` (ações da ficha) e, se quiser, os ganchos de combate (`onSideStart`, `onSideEnd`, `rollInitiative`...).
3. `client/index.js` exporta `init`, `openSheet`, `renderChatCard`, `tokenInfo` e os demais ganchos opcionais.
4. Troque `"system"` no `config.json` e reinicie.

## Desenvolvimento

```bash
npm test     # testes de integração: servidor real + Socket.IO (pool, TOC, crítico, Contra-Tiro, morte, permissões)
```

Código comentado em português; nomes de variáveis em inglês; interface 100% em português do Brasil.

## Licença

Código do QuestVTT: **GPL-3.0** (veja `LICENSE`). O conteúdo do sistema DuskBloods (textos e regras) pertence ao seu autor (@gabriell_jake).
