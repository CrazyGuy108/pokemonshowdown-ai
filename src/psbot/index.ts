// istanbul ignore file
import * as tf from "@tensorflow/tfjs";
import { join } from "path";
import { networkAgent } from "../ai/networkAgent";
import { avatar, latestModelFolder, loginServer, password, playServer,
    username } from "../config";
import { Logger } from "../Logger";
import { importTfn } from "../tfn";
import * as handlers from "./handlers"
import { PSBot } from "./PSBot";

// select native backend
importTfn(/*gpu*/ process.argv[2] === "--gpu");

// load neural network from disk in the background while connecting
const modelPromise = tf.loadLayersModel(
    `file://${join(latestModelFolder, "model.json")}`);

const logger = Logger.stderr;

(async function()
{
    const bot = new PSBot(logger.addPrefix("PSBot: "));

    try { await bot.connect(playServer); }
    catch (e) { logger.error("Connection error: " + (e?.stack ?? e)); }

    if (username) await bot.login({username, password, loginServer});
    if (avatar !== null) bot.setAvatar(avatar);

    const model = await modelPromise;
    const agent = networkAgent(model, "deterministic");

    bot.acceptChallenges("gen4randombattle",
        (room, user, sender) =>
            new handlers.battle.BattleHandler(
            {
                format: "gen4", username: user, agent, sender,
                logger: logger.addPrefix(`BattleHandler(${room}): `)
            }));
})();
