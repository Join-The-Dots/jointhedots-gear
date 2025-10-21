import { CommandModule } from "yargs"
import { file } from "../utils/file.js"

export function command_init(): CommandModule<any, {
}> {
   return {
      command: 'init',
      describe: 'Init project settings',
      builder: (yargs) => yargs,
      handler: async () => {
         const settings = file.read.json(".vscode/settings.json")
         file.write.json(".vscode/settings.json", {
            ...settings,
            "json.schemas": [
               {
                  "fileMatch": [
                     "application.json"
                  ],
                  "url": "./node_modules/@jointhedots/gear/schemas/application.schema.json"
               },
               {
                  "fileMatch": [
                     "component.json",
                     "*.component.json",
                     "component.yml",
                     "*.component.yml",
                     "component.toml",
                     "*.component.toml",
                  ],
                  "url": "./node_modules/@jointhedots/gear/schemas/component.schema.json"
               },
            ]
         })
      }
   }
}
