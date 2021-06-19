# `battle/`
This is the final step in parsing game events, where the rules of a Pokemon battle are applied to infer the battle state and make decisions based on it.

Subdirectories:
* [`agent/`](agent/) Provides a base interface for implementing the logic that decides what to do in a battle, such as an [adapter](../ai/networkAgent.ts) for a neural network.
* [`dex/`](dex/) Contains typings and generated data for use in a battle.
* [`parser/`](parser/) Is used as an interface between intepreted game events and actual battle state mutations and inferences.
  This is the main entry point for tracking a battle.
* [`state/`](state/) Has the data structure required for tracking all reasonably useful aspects of a battle.
