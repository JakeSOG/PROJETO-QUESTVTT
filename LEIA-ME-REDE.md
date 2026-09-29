# Como hospedar a mesa (LAN e Radmin VPN) — passo a passo

O QuestVTT roda **no PC do Mestre**. Os jogadores **não instalam nada**: só abrem um endereço no navegador (Chrome, Edge ou Firefox).

---

## 1. Instalar o Node.js (uma vez só)

1. Acesse **https://nodejs.org** e baixe a versão **LTS** (20 ou 22).
2. Instale clicando em "Avançar" até o fim (pode deixar tudo como está).

## 2. Configurar a mesa (uma vez só)

Abra o arquivo `config.json` com o Bloco de Notas e ajuste:

| Campo | O que é |
|---|---|
| `port` | Porta da mesa. Deixe `3000` se não souber. |
| `tableName` | Nome que aparece na tela de entrada. |
| `gmName` | Seu nome de Mestre (é com ele que você entra). |
| `gmPassword` | **Troque!** Senha do Mestre. |
| `tablePassword` | Senha da mesa (opcional). Deixe `""` para não pedir. |
| `autoApprovePlayers` | `false` = você aprova cada jogador novo. |

## 3. Instalar o Radmin VPN (para quem joga de outra casa)

1. Baixe em **https://www.radmin-vpn.com** e instale (você e cada jogador).
2. **Você (Mestre):** clique em *Rede → Criar rede*. Escolha um nome e uma senha.
3. Passe o **nome e a senha da rede** para os jogadores.
4. **Jogadores:** *Rede → Entrar em uma rede existente*, com o nome e a senha.
5. No Radmin aparece o seu IP virtual, que começa com **26.** (ex.: `26.123.45.67`).

> Jogando todos na mesma casa (mesmo Wi-Fi)? Pule o Radmin e use o endereço de "Rede local".

## 4. Liberar o Firewall (uma vez só)

Clique com o **botão direito** em `LIBERAR-FIREWALL.bat` → **Executar como administrador**.
Ele cria uma regra no Firewall do Windows para a porta da mesa.

## 5. Iniciar a mesa

Dê **dois cliques** em `INICIAR.bat`.

- Na primeira vez ele instala as dependências (alguns minutos, precisa de internet).
- Depois aparece algo assim:

```
  ✦ QuestVTT rodando — mesa "Noite de Caça em Yharnam"
  Local:      http://localhost:3000
  Rede local: http://192.168.0.15:3000
  Radmin VPN: http://26.123.45.67:3000   ← passe este para os jogadores
```

**Não feche essa janela** enquanto estiverem jogando. Para encerrar, feche a janela (ou Ctrl+C). Um backup é salvo ao iniciar, a cada 30 minutos e ao encerrar, na pasta `data/backups`.

## 6. Entrar

- **Você:** abra `http://localhost:3000`, digite o seu `gmName` e a `gmPassword`.
- **Jogadores:** abrem o endereço do Radmin (`http://26.x.x.x:3000`), escolhem um nome e **criam uma senha pessoal** (ela protege o nome deles). Você aprova na aba ⚙ e vincula cada um a uma ficha.

---

## Problemas comuns

| Sintoma | Solução |
|---|---|
| Jogador não abre a página | Confira se o Radmin mostra você **online** (ícone verde) para ele. Rode o `LIBERAR-FIREWALL.bat` como administrador. Teste o endereço completo com `http://` e a porta. |
| Radmin mostra o jogador **offline** / com triângulo amarelo | Os dois devem sair e entrar de novo na rede. Reinicie o Radmin. Verifique se algum antivírus/firewall está bloqueando o Radmin. |
| Antivírus bloqueou o Node.js | Adicione uma exceção para `node.exe` (normalmente em `C:\Program Files\nodejs`). |
| "A porta 3000 já está em uso" | Outro programa usa a porta. Feche-o, ou troque `port` no `config.json` (ex.: `3001`) e rode o `LIBERAR-FIREWALL.bat` de novo. |
| A mesa cai no meio da sessão | O PC do Mestre entrou em **suspensão**. Em *Configurações → Sistema → Energia*, coloque "Suspender" em **Nunca** enquanto joga. |
| Erro ao instalar (better-sqlite3) | Use o Node **LTS** (20 ou 22, 64 bits). Se persistir, instale as "Ferramentas de Build" marcando a opção durante a instalação do Node.js e rode `INICIAR.bat` de novo. |
| Sem som para os jogadores | O navegador bloqueia áudio até o primeiro clique: clique no aviso "🔊 Clique aqui para ativar o som". |
| Esqueci a senha pessoal de um jogador | Remova o usuário na aba ⚙ (a ficha continua) e peça para ele entrar de novo. |

## Backup e restauração

- Tudo fica em `data/questvtt.db` (um único arquivo). Os backups ficam em `data/backups`.
- Para restaurar: feche a mesa, apague `data/questvtt.db-wal` e `data/questvtt.db-shm` (se existirem), copie o backup escolhido para `data/questvtt.db` e inicie de novo.
