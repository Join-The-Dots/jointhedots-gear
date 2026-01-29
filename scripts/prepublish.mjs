import { script, directory, command, print } from '@polycuber/script.cli'

script((argv) => {
   print.title('Building @jointhedots/gear')

   // Clean esm directory
   print.info('Cleaning esm directory...')
   directory.clean('esm')

   // Compile TypeScript
   print.info('Compiling TypeScript...')
   const tscError = command.exec('npm run build')
   if (tscError) {
      print.error('TypeScript compilation failed')
      command.exit(1)
   }
   print.success('TypeScript compiled successfully')

   // Increase version
   /*print.info('Increasing version...')
   const versionError = command.exec('npm version patch --no-git-tag-version')
   if (versionError) {
      print.error('Version bump failed')
      command.exit(1)
   }
   print.success('Version increased successfully')*/

   print.success('Build completed!')
})
