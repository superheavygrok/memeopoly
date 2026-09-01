import React from 'react';
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faArrowLeft} from "@fortawesome/free-solid-svg-icons";
import {gameService} from "./services/GameService";

export default class Go extends React.Component{

    claimGo = () => {
        if (gameService.currentPlayer) {
            gameService.passedGo();
        }
    }

    render() {
        return (<div className={"go corner-card grid-area-0 " + this.props.boardPos} onClick={this.claimGo} title="Click to claim +50 $MEMEOPOLY when you pass GO">
            <div className="container">
                <div>Collect $200 salary as you pass</div>
                <div>GO</div>
                <div className="cpoly-claim">+50 $MEMEOPOLY</div>
                <div className="icon">
                    <FontAwesomeIcon icon={faArrowLeft}/>
                </div>
            </div>
        </div>);
    }
}
