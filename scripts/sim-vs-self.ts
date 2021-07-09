/** @file Initiates a battle sim where the user commands both sides. */
import { TeamGenerators } from "@pkmn/randoms";
import { BattleStreams, Streams, Teams } from "@pkmn/sim"

Teams.setGeneratorFactory(TeamGenerators);

const stream = new BattleStreams.BattleTextStream({debug: true});

Streams.stdin().pipeTo(stream);
stream.pipeTo(Streams.stdout());

stream.start();

stream.write(`>start {"formatid":"gen4randombattle"}
>player p1 {"name":"player1"}
>player p2 {"name":"player2"}
`);
