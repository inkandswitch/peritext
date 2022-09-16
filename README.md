# Peritext

This is a prototype implementation of Peritext, a [CRDT](https://crdt.tech/) for rich text with inline formatting. The algorithm is described in the following publications:

-   Online essay, [Peritext: A CRDT for Rich Text Collaboration](https://www.inkandswitch.com/peritext/)
-   Geoffrey Litt, Sarah Lim, Martin Kleppmann, and Peter van Hardenberg.
    [Peritext: A CRDT for Collaborative Rich Text Editing](https://www.inkandswitch.com/peritext/static/cscw-publication.pdf).
    Proceedings of the ACM on Human-Computer Interaction (PACMHCI), Volume 6, Issue [CSCW2](https://cscw.acm.org/2022/), Article 531, November 2022. [doi:10.1145/3555644](https://doi.org/10.1145/3555644)

This repo includes:

-   A Typescript implementation of the core Peritext CRDT algorithm
-   A prototype integration with the [Prosemirror](http://prosemirror.net/) editor library
-   An interactive demo UI where you can try out the editor
-   A test suite

## Try the editor demo

To see a basic interactive demo where you can type rich text into two editors and periodically sync them:

`npm install`

`npm run start`

## Code tour

**Algorithm code**: The main algorithm implementation is in `src/peritext.ts`. Because the goal of this work is to eventually implement a rich text type in [Automerge](https://github.com/automerge/automerge), we implemented Peritext as an extension to a codebase called `Micromerge`, which is a simplified implementation of Automerge that has mostly the same behavior but is less performance-optimized.

The essay describes the algorithm in three main parts:

-   [Generating operations](https://www.inkandswitch.com/peritext/#generating-inline-formatting-operations): happens in `changeMark`
-   [Applying operations](https://www.inkandswitch.com/peritext/#applying-operations): happens in `applyAddRemoveMark`
-   [Producing a document](https://www.inkandswitch.com/peritext/#producing-a-final-document): there are two places this logic is defined. `getTextWithFormatting` is a "batch" approach which iterates over the internal document metadata and produces a Prosemirror document. There is also a codepath that produces incremental patches representing changes (which is actually what powers the editor demo); these patches get emitted directly while applying the op, within `applyAddRemoveMark`.

**Prosemirror integration:** `src/bridge.ts` contains the code for the integration between the CRDT and the Prosemirror library. There are two main pieces to the integration:

-   Prosemirror to CRDT: when a change happens in the editor, Prosemirror emits a `Transaction`. We turn that transaction into a list of `InputOperation` commands for the CRDT, inside the `applyProsemirrorTransactionToMicromergeDoc` function.
-   CRDT to Prosemirror: when a change happens in the Micromerge CRDT, the CRDT emits a `Patch` object representing what changed. We turn this into a Prosemirror transaction with the `extendProsemirrorTransactionWithMicromergePatch` function.

Each direction of this transformation is straightforward, because the external interface of `InputOperation`s and `Patch`es provided by the CRDT closesly matches the Prosemirror `Transaction` format.

## Tests

`npm run test` will run the manual tests defined in `test/micromerge.ts`. These tests correspond to many of the specific examples explained in the essay.

You can also run a generative fuzz tester using `npm run fuzz`. This will randomly generate edit traces and check for convergence.

## Build demo artifact for essay

This repo also contains a UI that plays back a preset trace of edit actions, which is included in the Ink & Switch essay about Peritext.

To see that UI, you can run `npm run start-essay-demo`.

To build an artifact for including in the essay, run `npx parcel build src/essay-demo.ts`, and then copy the resulting `./dist/essay-demo.js` file to `content/peritext/static/peritext-demo.js` in the essays repo. Also copy over any CSS changes from `static/essay-demo.css` to `content/peritext/static/peritext-styles.css` if needed.
