# A Note on Cline's Diff Evaluation Setup

Hey there, this note explains what we're doing with Cline's diff evaluation (evals) system. It's all about checking how well various AI models (which users connect to Cline via their own API keys), prompts, and diffing tools can handle file changes.

## What We're Trying to Figure Out

The main idea here is to figure out which AI models (configured by users) are best at making `replace_in_file` tool calls that work correctly. This helps us understand model capabilities and also speeds up our own experiments with prompts and diffing algorithms to make Cline better over time. We want to know a few key things.

First, can the model create diffs, which are just sets of SEARCH and REPLACE blocks, that apply cleanly to a file? This is what we call `diffEditSuccess`.

Second, how do different LLMs, like Claude or Grok, stack up against each other when they try to make these diff edits? We use a standard set of real-world test cases for this.

Third, do different system prompts, say our `basicSystemPrompt` versus the `claude4SystemPrompt`, change how well a model does at diff editing?

Fourth, we're also looking at different ways to apply the diffs themselves. We have a few algorithms like `constructNewFileContentV1`, `V2`, and `V3`, and we want to see which ones are more robust when fed model-generated diffs.

Fifth, we track how fast the model starts making an edit. The `timeToFirstEditMs` metric gives us a hint about how quickly a user would see changes happening in their editor.

And finally, we keep an eye on how many tokens are used and what it costs for each model and each try. This helps us compare how efficient they are.

Right now, these evals are mostly about whether the diff *applies* correctly. That means, do the SEARCH blocks find a match, and can the REPLACE blocks be put in without an error? We're not yet deeply analyzing if the change is valid code or matches what the user *wanted* semantically. That's a problem for another day, and will require a lot more scaffolding.

## How We Run These Tests

Two prerequisites:

1. Make sure you have an `evals/.env` file with `OPENROUTER_API_KEY=<your-openrouter-key>` 

2. Make sure you add a `evals/diff-edits/cases` folder with all the conversation jsons prior to running this. 


Our testing strategy is based on replaying situations from actual user sessions where diff edits were tried.

It starts with our test cases. Each one is a JSON file in `./cases` that has the conversation history that led to a diff edit, the original file content and its path, and the info needed to rebuild the system prompt from that original session.

Then, for every test run, we set up a specific configuration. This includes which LLM we're testing, which system prompt it gets, which function we use to parse the model's raw output, and which function we use to actually apply the diff. Here's the command I've been using:

```bash
npm run diff-eval -- --model-ids "anthropic/claude-3-5-sonnet-20241022,x-ai/grok-3-beta" --max-cases 4 --valid-attempts-per-case 2 --verbose --parallel
```

This will build the eval script, run it, and then open the streamlit dashboard to show the results.

The `TestRunner.ts` script is the main coordinator. For each test case and setup, `ClineWrapper.ts` takes over and sends the conversation and system prompt to the LLM. We then watch the model's response as it streams in and parse it to find any tool calls.

We're specifically looking for the model to make a single `replace_in_file` tool call. Multiple edits in one tool call are allowed, and recorded (in case you want to filter results by number of edits in a single tool call and compare success rate for that slice across different models/system prompts/etc). If it does, and it's for the correct file, we grab the diff content it produced. Then, the chosen diff application algorithm tries to apply that diff to the original file. We record whether this worked or not as `diffEditSuccess`.

We record a bunch of data for every attempt into a database. This includes details about the model and prompt, token counts, costs, the raw output from the model, the parsed tool calls, whether it succeeded or failed, any error messages, and timing info. For a detailed explanation of the database schema, see [database.md](./database.md).

A big part of this is how we handle "valid attempts," which I'll explain next.

## Keeping it Fair with "Valid Attempts"

LLMs can be unpredictable. If we replay an old scenario, a new model, or even the same model later, might do something completely different than what happened originally. It might call another tool or ask a question instead of trying a diff edit.

Since we really want to test the *diff editing* part, we need a way to make sure we're comparing fairly. That's why we have this idea of "valid attempts."

An attempt is "valid" for this benchmark if the model actually tries to do what we're interested in. This means two things. One, it must call the `replace_in_file` tool. Two, it must target the *same file path* that was targeted in the original recorded conversation for that test case.

If the model does something else, like calling a different tool or picking the wrong file, we don't count that attempt against its diff editing score. Instead, we consider it an "invalid attempt" for *this specific benchmark* and simply re-run that test case with that model. We keep doing this until we've collected a set number of these "valid attempts."

For example, if we ask for 5 valid attempts per test case, the system will keep re-rolling for that case until the model has tried to edit the correct file using the `replace_in_file` tool 5 times. Only then do we look at how many of those 5 valid attempts actually resulted in a successful diff application (`diffEditSuccess`).

This way, if we're comparing two models and one gets a 10% success rate on its valid diff edit attempts, and another gets 90%, we have a much clearer picture of their actual diff-generating capabilities. It avoids muddying the waters with attempts where the model didn't even try to perform the specific action we're evaluating. This approach helps us isolate and measure the diff-editing skill more directly, despite the non-deterministic nature of these models.

## Replays

You can also use the replay argument to replay a previous benchmark run. This is super useful for iterating on our diffing algorithms without having to re-run expensive and time-consuming LLM calls.

When you run an evaluation, every detail is stored in the database—including the raw, unmodified output from the model. The replay feature takes advantage of this by pulling that raw output and feeding it into a *different* diffing algorithm. This lets you isolate the performance of the diffing logic itself. We can see if a new algorithm is better at applying the exact same set of diffs that a model generated in a previous run.

This process is blazingly fast and free, as it completely bypasses the need to make new API calls. It ensures a true apples-to-apples comparison between diffing strategies, since the model's output—the "ground truth" for the evaluation—remains identical.

Here’s an example of how you would replay a previous run with a new diffing algorithm:

```shell
cd evals && npm run diff-eval -- --replay-run-id 9902189e-63a8-4210-a4fc-fe59e2eaf2c2 --diff-apply-file diff-06-23-25 --verbose
```

In this command:
-   `--replay-run-id` specifies the original run we want to use as our ground truth.
-   `--diff-apply-file` tells the script to use the new diffing logic from the `diff-06-23-25.ts` file.

The script will then create a new run in the database that mirrors the original, but with the results of applying the new diffing algorithm. This allows for a direct comparison in the dashboard, helping us quickly see which of our diffing strategies is the most robust.
