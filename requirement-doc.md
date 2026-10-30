# PRODUCT REQUIREMENTS DOCUMENT (PRD)
# Project: Kingdoms of Eternity
**Version:** 2.0  
**Project Type:** Browser-based Real-Time Strategy (RTS)  
**Development Model:** Solo founder + AI-assisted development  
**Initial Budget:** $0 additional development expenditure target  
**Primary AI Development Tool:** Claude Code  
**Initial Goal:** Build, test and validate a playable eight-player multiplayer RTS game before seeking investors.

---

# 1. Executive Summary

Kingdoms of Eternity is a browser-based real-time strategy game inspired by the original Age of Empires.

Players develop civilizations, gather resources, construct settlements, research technologies, train armies, explore maps and battle other players.

The game will have an original storyline, original civilizations, original artwork and an independent identity.

The defining product feature is that up to eight players can play together in a real-time multiplayer match directly through their browsers.

Players should be able to open a website, create a room, invite friends and start playing without downloading or installing anything.

### Our development philosophy

We will not start by hiring a large team or investing thousands of dollars.

Instead, we will:

1. Use Claude Code as our primary AI development assistant.
2. Use free and open-source technologies.
3. Build the game incrementally.
4. Test every feature before moving forward.
5. Run multiplayer tests with real people.
6. Establish a community and validate demand.
7. Seek investors only after demonstrating a working product and user interest.

**The first objective is not to build a massive game. It is to build a genuinely enjoyable game that works reliably.**

# 2. Product Vision

Create an accessible browser-based RTS experience that brings back the classic civilization-building and strategic warfare experience.

The game should prioritize:

- Simple and intuitive controls.
- Enjoyable economic management.
- Strategic military gameplay.
- Responsive unit movement.
- Multiplayer with up to eight players.
- Stable real-time synchronization.
- Fast loading.
- Original storytelling.
- Low infrastructure costs.

The game should feel familiar to fans of classic RTS games without copying Age of Empires' protected assets, maps, music, characters, branding or source code.

# 3. Target Platforms

### Initial release

- Desktop browsers.
- Google Chrome.
- Microsoft Edge.
- Mozilla Firefox.
- Safari, subject to compatibility testing.

### Not included initially

- Native Windows application.
- Native macOS application.
- Android application.
- iOS application.
- Console versions.

The browser must be sufficient to access and play the complete initial game.

# 4. Core Game Concept

Every player begins with a small settlement and limited resources.

Players must develop their civilizations by:

1. Collecting resources.
2. Constructing buildings.
3. Expanding their settlements.
4. Training villagers.
5. Researching technologies.
6. Developing military forces.
7. Exploring the world.
8. Defending their territories.
9. Attacking competing civilizations.

Players can cooperate through teams or compete independently.

The game must support both economic and military strategies.

# 5. Multiplayer Requirements

This is the highest-priority technical requirement.

### 5.1 Player capacity

- Maximum eight players per match.
- Minimum two players for multiplayer.
- Each player controls an independent civilization.
- Players can participate simultaneously.
- A match must continue if an individual player disconnects.

### 5.2 Room management

Players must be able to:

- Create a multiplayer room.
- Join through a room code.
- Join through an invitation link.
- Set a private room password.
- Invite friends.
- Select their civilization.
- Select teams.
- Select maps.
- Configure game settings.
- Start the match.

The room creator becomes the lobby administrator, but the game server remains authoritative.

### 5.3 Match configurations

- Free-for-all.
- 1v1.
- 2v2.
- 3v3.
- 4v4.
- Private matches.
- Public matches.

### 5.4 Multiplayer synchronization

The game must use an authoritative server architecture.

The server is responsible for:

- Validating player commands.
- Managing resources.
- Calculating unit movement.
- Calculating combat outcomes.
- Managing building construction.
- Processing technology research.
- Synchronizing match states.
- Determining victory conditions.

Clients must never be trusted to determine their own authoritative resources, unit health or combat results.

### 5.5 Network performance

Initial targets:

| Metric | Target |
|---|---|
| Maximum players | 8 |
| Simulation rate | 20 ticks/second |
| Client rendering | Target 60 FPS |
| Minimum acceptable rendering | 30 FPS on supported hardware |
| Regional command latency | Under 150 ms under defined test conditions |
| Reconnection | Target under 10 seconds |
| Match consistency | No divergent authoritative game states |

These targets must be validated through actual multiplayer testing.

The game must use interpolation, efficient state synchronization and appropriate network update strategies.

The game should remain playable under ordinary home internet conditions.

A temporary internet disconnection must not freeze the other seven players.

# 6. Core Gameplay Systems

## 6.1 Civilization management

Every player starts with:

- One Town Center.
- A small group of villagers.
- Starting resources.
- An unexplored map.
- A designated starting territory.

Players can:

- Select individual units.
- Select multiple units.
- Move units.
- Assign work.
- Construct buildings.
- Train units.
- Research technologies.
- Establish defensive positions.
- Create military formations.

## 6.2 Resource management

The initial game uses four primary resources.

| Resource | Purpose |
|---|---|
| Food | Villagers, military and economy |
| Wood | Buildings, structures and military |
| Stone | Defensive structures and advanced buildings |
| Gold | Advanced military and technologies |

Resource collection must be visually represented.

Villagers should move to resource locations, perform work animations and return resources to appropriate drop-off points.

Resource balances must be calculated by the server.

## 6.3 Villager system

Villagers are the foundation of the economy.

They should be able to:

- Gather food.
- Chop wood.
- Mine gold.
- Mine stone.
- Construct buildings.
- Repair damaged buildings.

Each villager should have health, movement speed, working speed and assigned task.

Players must be able to change villager assignments at any time.

## 6.4 Building system

Initial building roster:

1. Town Center
2. House
3. Farm
4. Lumber Camp
5. Mining Camp
6. Barracks
7. Archery Range
8. Stable
9. Blacksmith
10. Market
11. Watchtower
12. Stone Wall
13. Gate
14. Siege Workshop

Every building must have:

- Resource requirements.
- Construction duration.
- Health.
- Building footprint.
- Ownership.
- Destruction mechanics.
- Unit production or research functionality where applicable.

## 6.5 Military system

Initial unit categories:

**Infantry**
- Militia
- Swordsman
- Spearman

**Archers**
- Archer
- Crossbowman

**Cavalry**
- Scout
- Light Cavalry
- Knight

**Siege**
- Battering Ram
- Catapult

**Support**
- Healer
- Scout

Each unit must have:

- Health points.
- Attack damage.
- Armor.
- Attack speed.
- Movement speed.
- Attack range.
- Training cost.
- Training duration.

Combat calculations must be authoritative on the server.

Units must respond to commands predictably.

## 6.6 Technology progression

The game initially uses four development ages:

1. Dark Age.
2. Feudal Age.
3. Castle Age.
4. Imperial Age.

Each progression level unlocks additional technologies, buildings and military units.

The technology tree will be original and balanced independently.

## 6.7 Fog of war

The game must implement:

- Explored territory.
- Currently visible territory.
- Hidden enemy settlements.
- Limited enemy visibility.
- Scouting mechanics.

Players should not receive hidden information from other players' civilizations.

# 7. Map System

Initial release should contain 3–5 balanced maps.

Terrain types:

- Grassland.
- Forest.
- Desert.
- Mountains.
- Rivers.
- Lakes.
- Coastal areas.

Map functionality:

- Resource placement.
- Starting locations.
- Terrain obstacles.
- Unit navigation.
- Fog of war.
- Pre-designed maps.
- Basic random map generation, if feasible within the MVP.

A full map editor is excluded from the first release.

# 8. Storyline and Original World

The game must have its own fictional world.

We should create:

- An overarching storyline.
- Multiple civilizations.
- Distinct cultures.
- Original leaders.
- Political conflicts.
- Wars and alliances.
- Territory disputes.
- Unique military identities.

The story should be developed as a separate creative workstream.

### Campaign requirements

Future campaign missions should include:

- Story introduction.
- Mission objectives.
- Optional objectives.
- Unique starting conditions.
- Defined victory conditions.
- Narrative endings.
- Unlockable missions.

The initial multiplayer MVP does not depend on a fully developed single-player campaign.

The original universe and its visual identity should be established early, while full campaign production can follow after multiplayer validation.

# 9. User Interface and Experience

The interface should be simple and inspired by classic RTS layouts.

### Main screens

1. Landing page.
2. Login and registration.
3. Main menu.
4. Single-player campaign.
5. Multiplayer lobby.
6. Civilization selection.
7. Map selection.
8. Gameplay.
9. Pause menu.
10. Match results.
11. Player profile.

### Gameplay interface

The game screen must provide:

- Resource indicators.
- Main world map.
- Minimap.
- Selected unit information.
- Building menus.
- Unit training queues.
- Technology research.
- Player and team information.
- Game settings.

### Controls

| Action | Control |
|---|---|
| Select unit | Left-click |
| Multiple selection | Drag selection box |
| Move | Right-click |
| Attack | Attack command |
| Camera movement | WASD / screen edges |
| Zoom | Mouse wheel |
| Unit groups | Ctrl + 1–9 |
| Select group | 1–9 |

Controls must be responsive and intuitive.

# 10. Technical Architecture

We will use an open-source, TypeScript-based architecture.

### Frontend

- TypeScript.
- Phaser 3.
- WebGL rendering.
- HTML/CSS for menus and interface elements.

### Multiplayer backend

- Node.js.
- TypeScript.
- Colyseus.
- WebSockets.
- Authoritative match simulation.

### Database

- PostgreSQL.
- Redis only when justified by actual requirements.

### Deployment and development

- GitHub.
- Docker.
- GitHub Actions.
- Cloudflare CDN.
- Sentry or equivalent monitoring.

### Proposed architecture

Browser Game Client  
↓  
WebSocket Connection  
↓  
Authoritative Multiplayer Server  
↓  
Game Simulation and Match State  
↓  
PostgreSQL for persistent accounts and progression

The architecture must remain modular.

Gameplay rules, rendering, multiplayer communication and persistent data must be separated so individual systems can be changed without rewriting the entire game.

# 11. AI-Assisted Development Strategy

Claude Code will be the primary development assistant.

The founder will supervise architecture, implementation, testing and product decisions.

Claude will assist with:

- Writing code.
- Implementing game mechanics.
- Creating components.
- Building backend services.
- Writing automated tests.
- Reviewing code.
- Debugging.
- Refactoring.
- Documentation.

### Development rules

1. Claude must read the project documentation before implementing features.
2. Every feature must have a defined acceptance criterion.
3. Changes must be made incrementally.
4. Every milestone must pass its tests.
5. No unnecessary dependencies.
6. No large unreviewed code dumps.
7. No duplicated game logic across client and server.
8. All game-critical calculations must be server-authoritative.
9. All code must be committed to GitHub.
10. Existing working features must not be broken by new changes.

Claude must not be allowed to declare features complete without test evidence.

# 12. Development Phases

The following is an initial planning schedule, subject to revision based on actual progress.

| Phase | Scope | Target |
|---|---|---|
| 1 | Project setup, map and camera | Weeks 1–2 |
| 2 | Villagers, resources and economy | Weeks 3–4 |
| 3 | Buildings, units and combat | Weeks 5–6 |
| 4 | Multiplayer rooms and synchronization | Weeks 7–10 |
| 5 | Story identity, maps and UI | Weeks 11–12 |
| 6 | Public beta and optimization | Weeks 13–16 |

### Milestone 1: First playable world

A player can open the browser and interact with a world containing terrain, villagers and resources.

### Milestone 2: Economic gameplay

A player can gather resources, construct buildings and train units.

### Milestone 3: Military gameplay

A player can command armies and fight computer-controlled enemies.

### Milestone 4: Multiplayer

Two to eight players can play together in real time.

### Milestone 5: Complete multiplayer experience

Players can create rooms, invite friends, select civilizations, play matches and receive match results.

### Milestone 6: Closed/public beta

The game is deployed and tested with actual players.

# 13. Testing and Quality Requirements

The product must prioritize reliability over feature quantity.

### Automated testing

- Unit tests for economic calculations.
- Unit tests for combat.
- Unit tests for building construction.
- Unit tests for unit movement commands.
- Multiplayer integration tests.
- Authentication tests.
- Match lifecycle tests.

### Multiplayer testing

The game must be tested with eight simultaneous browser clients.

Testing must include:

- Normal internet conditions.
- High latency.
- Packet loss.
- Temporary disconnections.
- Reconnection.
- Simultaneous player commands.
- Multiple simultaneous matches.
- Server restarts.
- Invalid commands.
- Attempts to manipulate game state.

### Quality targets

- No known critical bugs at release.
- No known game-breaking exploits.
- No permanent match-state corruption.
- No resource duplication exploits.
- No unauthorized player control.
- Consistent match outcomes.
- Stable performance under the declared test conditions.

Absolute zero bugs and zero lag cannot be guaranteed. We will instead use measurable performance and reliability targets.

# 14. Budget and Infrastructure Strategy

The project will begin with a $0 additional development expenditure target.

This means we will use existing subscriptions and free/open-source software wherever possible.

### Initial tool budget

| Tool | Cost |
|---|---:|
| Claude Code | Existing subscription |
| Phaser 3 | Free |
| Colyseus | Open source |
| TypeScript | Free |
| Node.js | Free |
| PostgreSQL | Free |
| GitHub Free | Free |
| Docker | Free |
| Playwright | Free |
| Local testing | Free |

The existing Claude subscription is treated as an already-paid development resource, not an unlimited coding allowance.

### Hosting strategy

**Stage 1: Local development**

- Game client runs locally.
- Game server runs locally.
- PostgreSQL runs locally.
- Multiple browser clients connect to the same server.

Additional cost: $0.

**Stage 2: Private testing**

Use suitable free hosting tiers or a temporary low-cost server.

Estimated additional cost: $0–$20/month.

**Stage 3: Public beta**

Use a persistent game server, managed or self-hosted database, CDN and backups.

Estimated infrastructure allowance: $50–$150/month initially.

### Long-term operating costs

| Scale | Estimated monthly infrastructure |
|---|---:|
| Development | $0 |
| Private testing | $0–$20 |
| Small beta | $50–$150 |
| 40–200 concurrent players | $150–$500 |
| 200–1,000 concurrent players | $500–$2,000 |

These are planning allowances, not guaranteed hosting quotations.

Costs depend on server utilization, match duration, traffic, regions and database requirements.

# 15. Features Excluded from the Initial MVP

To avoid scope creep, the following are excluded:

- Native mobile apps.
- Ranked competitive matchmaking.
- Global leaderboards.
- Clan systems.
- Voice chat.
- In-game purchases.
- Marketplace.
- Paid cosmetics.
- Spectator mode.
- User-generated campaigns.
- Advanced modding.
- Large-scale tournaments.
- Complex AI opponents.
- Multiple server regions.

These can be introduced after product validation.

# 16. Definition of MVP Completion

The initial MVP will be considered complete when:

- The game is accessible through a browser.
- Players can create accounts or join supported guest sessions.
- Players can create and join rooms.
- Eight players can participate in one match.
- Players can choose civilizations.
- Players can gather resources.
- Players can build settlements.
- Players can train armies.
- Players can fight other players.
- Fog of war works.
- Victory conditions work.
- Temporary disconnections are handled.
- The server remains authoritative.
- Performance targets pass eight-client tests.
- The game has no known critical bugs.
- The application can be deployed and updated reliably.

# 17. Investor and Business Strategy

We will not seek investment at the beginning.

Our initial investment will primarily be time and development effort.

### Stage 1: Build

Deliver a working game with basic economic and military gameplay.

### Stage 2: Validate

Invite friends and external testers.

Collect feedback and identify gameplay issues.

### Stage 3: Establish traction

Target:

- 500–1,000 registered players.
- Repeat players.
- Consistent multiplayer sessions.
- Evidence of player retention.
- An active community.

These are aspirational targets, not guarantees or mandatory conditions for seeking investment.

### Stage 4: Investor preparation

Prepare:

- Working product demonstration.
- Gameplay trailer.
- User statistics.
- Retention data.
- Infrastructure cost breakdown.
- Development roadmap.
- Business model.
- Funding requirements.

### Potential revenue models

- Free-to-play.
- Premium single-player campaigns.
- Cosmetic purchases.
- Additional civilizations.
- Expansion packs.
- Community events and tournaments.

Gameplay balance must never depend on purchasing advantages.

# 18. Final Product Principles

Every development decision must follow these principles:

1. Simplicity over unnecessary complexity.
2. Working features over impressive-looking prototypes.
3. Multiplayer stability over additional content.
4. Original intellectual property.
5. Open-source technologies wherever practical.
6. Minimal infrastructure expenditure.
7. Modular and maintainable architecture.
8. Continuous automated testing.
9. No premature scaling.
10. No investor dependency before product validation.

---

# FINAL PROJECT OBJECTIVE

Build an original browser-based real-time strategy game inspired by the classic Age of Empires experience.

It must allow up to eight players to join the same match, build civilizations, gather resources, construct buildings, train armies and fight in real time.

It must run directly in the browser, without installation.

The game will initially be developed by a solo founder using Claude Code and free/open-source technologies.

The first goal is a working, enjoyable, reliable multiplayer MVP with minimal additional financial expenditure.

Once the product demonstrates genuine user interest and multiplayer reliability, we will evaluate investment, expand the development team and build the complete game world.

**We build first. We prove demand second. We raise money third.**