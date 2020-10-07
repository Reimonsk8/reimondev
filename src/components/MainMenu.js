import React from 'react';
import Auth from 'aws-amplify';
import awsconfig from '../aws-exports';
import {withAuthenticator} from 'aws-amplify-react';

Auth.configure(awsconfig);

const MainMenu = () => {
    return(
        <div>
            <p>
                Reimon <code> Testing </code> new stuff.
            </p>
            <p>WELCOME</p>
            <p className="App-link">
                Chopin is beautiful
            </p>
            <p>Main Menu</p>
            <p className="App-link">
                Chopin i love u
            </p>
        </div>
    )
}
export default withAuthenticator(MainMenu, {includeGreetings: true});
