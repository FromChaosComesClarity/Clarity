Clarity 1.9.3

**The app is going through changes, and this build should be treated as experimental.** It is
what I run myself, but the project is being reworked and behaviour may change between releases
while that is going on. The website is offline for the same reason. It has not gone anywhere,
it is simply not being served. Everything you need is in the README and in the manual that
ships inside the app.

This release is five fixes, and four of them are the same mistake wearing different clothes: a
failure turned into nothing at all, and then reported as success, or as a cause that was not
true.

## Installing a game left it unable to start

**A game could install perfectly and then refuse to launch**, saying only that it was *not found
in Installer database*. The files were there. The library showed it installed. Pressing Play found
nothing.

Games are recorded in Installer's own database by the owned-library sync, not by installing. Where
that sync had never run, a fresh configuration beside a restored library, which is exactly what
moving to a new machine leaves behind. The install had no record to update, so it skipped
writing one **and skipped installing the game's compatibility files**, then reported success
anyway. An install now creates that record itself rather than depending on a sync having happened
first.

**A game's compatibility files can now be installed without reinstalling the game.** GOG ships
things like OpenAL and the Visual C++ runtimes alongside a title and expects them installed into
the Proton prefix; a game missing one starts and closes instantly with nothing explaining why.
There is now a button for it on the game's page, beside Manage DLCs. Anything installed by an
earlier version that skipped this step can be repaired from there instead of being downloaded
again.

## Your graphics card was being blamed for other people's problems

**A launch failure that could not be explained was reported as "your GPU has no Vulkan support"**
, confidently, with a paragraph about DXVK, on hardware where it was plainly untrue.

The rule that decided this keyed on two lines that carry no information: one that Proton prints
on every single launch, and one that appears for any game installed under your home folder. It
appeared in a launch that *succeeded*. So nearly any unexplained failure produced a hardware
diagnosis and a suggestion that could not help.

The app now checks whether the machine actually has a Vulkan driver before saying it does not. A
computer that genuinely lacks one still gets the original explanation, which was a good one.
Everything else falls back to showing the log instead of inventing a cause. **"The game lost its
connection to the display"** is now recognised as its own thing rather than being folded into the
Vulkan answer.

## The app tells you when a store is signed out

**Installing a GOG or Epic game while signed out failed with no explanation.** The install window
showed free space, no download size, and a button that could only fail. Being signed out is by
far the commonest reason for that, so the window now says so plainly, and the button becomes
**Sign in**, then picks up where you left off.

## Interface scale on more than one monitor

**The interface could come up small on a large screen.** With several monitors connected, the
scale was worked out from whichever display the system happened to name first, which on a fresh
install is not reliably the one you are using, a wide monitor beside a small vertical one
derived its size from the small one. Placement and scale now agree with each other.

**A scale you chose is no longer discarded.** A saved setting from another machine, or one saved
before this was tracked, was re-derived on every start; it is now kept unless it genuinely does
not fit, and moving the window between monitors is no longer mistaken for a different computer.

## Also

- The library's installed-state marker was never actually being written after an install; it
  matched on a column that does not exist and failed silently. The same wrong column in Couch
  could abandon a sync partway through.
- Download progress showed a numeric id instead of the game's name when the game had not been
  synced yet.
- The Support button now shows the donation details inside the app, with Copy buttons, instead of
  opening a website page that is currently offline. Nothing in the app opens a browser for this
  any more, so it works with no network at all.

⚠️ **Linux only.** No new macOS build; 1.9.0's dmg remains current there.
