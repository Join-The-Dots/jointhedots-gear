
export type CommonSetting = Record<string, any>

export type SettingGroup =
   "service_points" |
   "components" |
   "shareds"

export type SettingStores<T> = {
   [id in SettingGroup]: Record<string, T>
}

export enum WriteMode {
   Default,
   Reset,
   Temporary,
}

export class AccountSettings {
   key: string = null
   stores = createSettingStores<string>()
   temporaries = createSettingStores<string>()
   settings = createSettingStores<CommonSetting>()

   constructor(readonly name: string) {
      this.key = `settings://${this.name}`

      try {
         const bytes = localStorage.getItem(this.key)
         this.restore(JSON.parse(bytes).stores)
      } catch (_) { }

      try {
         window.addEventListener("storage", (evt) => {
            const { key, newValue } = evt
            if (key === this.key) {
               try { this.restore(JSON.parse(newValue).stores) }
               catch (_) { }
            }
         })
      } catch (e) { console.error(e.message) }
   }

   get<T = any>(group: SettingGroup, key: string): T {
      let data = this.settings[group][key]
      if (!data) {
         const bytes = this.temporaries[group][key] || this.stores[group][key]
         if (bytes) {
            data = JSON.parse(bytes)
            this.settings[group][key] = data
         }
      }
      return data as T
   }
   set<T = any>(group: SettingGroup, key: string, descriptor: T, mode = WriteMode.Default): boolean {
      const data = JSON.stringify(descriptor)
      if (this.write(group, key, data, mode)) {
         this.settings[group][key] = descriptor
         notifySettingsChange(this, group, key)
         return true
      }
      return false
   }
   list(group: SettingGroup): string[] {
      if (Object.keys(this.temporaries[group]).length > 0) {
         return Object.keys(Object.assign({}, this.stores[group], this.temporaries[group]))
      }
      else {
         return Object.keys(this.stores[group])
      }
   }

   read(key: string): string {
      return this.stores[key]
   }
   write(group: SettingGroup, key: string, data: string, mode: WriteMode): boolean {
      if (mode !== WriteMode.Reset && this.temporaries[group][key] !== undefined) {
         mode = WriteMode.Temporary
      }
      if (mode === WriteMode.Temporary) {
         if (this.temporaries[group][key] !== data) {
            this.temporaries[group][key] = data
            this.settings[group][key] = null
            return true
         }
      }
      else if (this.stores[group][key] !== data) {
         this.stores[group][key] = data
         this.settings[group][key] = null
         if (mode === WriteMode.Default) {
            localStorage.setItem(this.key, JSON.stringify({ stores: this.stores }))
         }
         return true
      }
      return false
   }
   restore(stores: SettingStores<string>) {
      for (const group in stores) {
         for (const key in stores[group]) {
            if (this.write(group as SettingGroup, key, stores[group][key], WriteMode.Reset)) {
               notifySettingsChange(this, group as SettingGroup, key)
            }
         }
      }
   }
}

type SettingsChangeHandler = (group: SettingGroup, id: string) => void
const Settings_ChangeHandlers = new Set<SettingsChangeHandler>()
const Settings = new AccountSettings("default")

export function getSettings(): AccountSettings {
   return Settings
}

export function listenSettings(handler: SettingsChangeHandler) {
   Settings_ChangeHandlers.add(handler)
   return handler
}

export function unlistenSettings(handler: SettingsChangeHandler) {
   Settings_ChangeHandlers.delete(handler)
}

function notifySettingsChange(settings: AccountSettings, group: SettingGroup, key: string) {
   if (settings === Settings && settings.settings[group][key] !== undefined) {
      for (const handler of Settings_ChangeHandlers) {
         handler(group, key)
      }
   }
}

function createSettingStores<T>(): SettingStores<T> {
   return {
      service_points: {},
      components: {},
      shareds: {},
   }
}
