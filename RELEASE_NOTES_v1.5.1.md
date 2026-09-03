Clarity 1.5.1

Downloads that used to stop dead now finish.

## Fixes

**A download can no longer be defeated by one bad file on GOG's end.** Colony Ship: A Post-Earth Role Playing Game stopped at 50.5% and stayed there — for over an hour, with the connection busy the whole time and no error anywhere.

GOG serves a game from more than one content server, and those servers don't always hold the same thing. One file in that game was damaged on one of them: every request returned about half of it and then hung up. Clarity kept asking the same server, over and over, for a file it was never going to get — so the download appeared to be running at full speed while making no progress at all, permanently.

It now moves to GOG's other server when a file arrives damaged, and checks each copy as it lands rather than after the fact. The file that could never be fetched before now arrives on the second attempt.

This was never specific to one game. Any download could have hit it, and a big one had more chances to.

**Three more ways a download could hang, closed.** An expired sign-in during a long download used to be retried forever instead of simply refreshing — so a download that outlived its hour could stall and never recover. A progress-reporting queue could fill up and freeze the transfer behind it, which grew more likely the larger the download. And requests to GOG had no time limit at all, so a server that stopped responding without disconnecting would be waited on indefinitely.

## New

**The app tells you when a download has stopped moving.** The one thing all of the above had in common is that nothing said anything: the percentage simply stopped, and only you could notice.

Clarity now watches that number. If it hasn't moved for a few minutes, the Download Manager turns red and says so, with what is probably happening and what to do about it.

It won't cancel anything for you. It can't tell a genuine stall from a slow patch, and quietly throwing away a part-finished download would be worse than telling you and letting you choose. If you do restart one, nothing is lost — downloads continue from where they stopped.

## Install

1. Download `Clarity.AppImage` below
2. `chmod +x Clarity.AppImage`
3. Run it

Upgrading from any 1.x? Just replace the AppImage. Your `GameManagerConfig` folder — your entire library — is untouched. A download that is currently stuck will continue where it left off once you restart it.
