import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { GAME_SESSION } from './game-session.interface';
import { SetGameService } from './set-game.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: route params/query-params bind as @Input() automatically.
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(withEventReplay()),
    // Global default: single-player. Room routes override this with MultiplayerGameSession.
    { provide: GAME_SESSION, useExisting: SetGameService },
  ]
};
