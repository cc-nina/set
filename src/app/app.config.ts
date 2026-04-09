import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { GAME_SESSION } from './game-session.interface';
import { SetGameService } from './set-game.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    // Wire the GAME_SESSION token to the single-player implementation.
    // Routes that need multiplayer will override this at the component/route level.
    { provide: GAME_SESSION, useExisting: SetGameService },
  ]
};
