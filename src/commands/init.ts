import { type CommandModule } from "yargs"
import { file } from "../utils/file.ts"

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
                     "application.json",
                     "*.application.json",
                     "application.yaml",
                     "*.application.yaml",
                     "application.yml",
                     "*.application.yml",
                     "application.toml",
                     "*.application.toml",
                  ],
                  "url": "./node_modules/@jointhedots/gear/schemas/application.schema.json"
               },
               {
                  "fileMatch": [
                     "component.json",
                     "*.component.json",
                     "component.yaml",
                     "*.component.yaml",
                     "component.yml",
                     "*.component.yml",
                     "component.toml",
                     "*.component.toml",
                  ],
                  "url": "./node_modules/@jointhedots/gear/schemas/component.schema.json"
               },
               {
                  "fileMatch": [
                     "declaration.json",
                     "*.declaration.json",
                     "declaration.yaml",
                     "*.declaration.yaml",
                     "declaration.yml",
                     "*.declaration.yml",
                     "declaration.toml",
                     "*.declaration.toml",
                  ],
                  "url": "./node_modules/@jointhedots/gear/schemas/declaration.schema.json"
               },
            ]
         })
      }
   }
}
