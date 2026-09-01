import React from 'react';
import Dialog from "./components/Dialog";

export default class HelpDialog extends React.Component {

    render() {
        return (<Dialog dismiss={this.props.dismiss} actions={[{name: 'Close', click: this.props.dismiss}]}>
            <h1>Memeopoly</h1>
            <p>Welcome to Memeopoly -- the meme-powered multiplayer board game!</p>
            <p>Properties represent meme coins and degen projects. The in-game currency is $MEMEOPOLY tokens.
                Roll the dice, move your token, and build your meme empire. If you pass through GO, the banker
                sends you $200 in $MEMEOPOLY tokens. House rules and deals are encouraged -- just like in meme culture, anything goes.</p>
            <p>
                You can make change with other players etc... If you buy a deed, the person in charge of the bank needs
                to give it to you and you need to send the $MEMEOPOLY tokens to the bank yourself.
            </p>

            <p>Every action needs to be done by a player and is logged in the "Logs" panel so you don't miss
                anything</p>

            <p>Any issue or request for the game? Reach out to customer support via our <a href="https://x.com/memeopoly" target="_blank">X page</a></p>
        </Dialog>);
    }
}
