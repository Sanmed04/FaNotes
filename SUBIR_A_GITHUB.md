# Subir FaNotes a GitHub

El repositorio local ya está listo (git init + primer commit). Solo falta crear el repo en GitHub y enlazarlo.

## Opción 1: Desde la web de GitHub

1. Entra en **https://github.com/new**
2. **Repository name**: `FaNotes`
3. Elige **Public**
4. **No** marques "Add a README" (ya tienes uno en el proyecto)
5. Clic en **Create repository**
6. En la carpeta del proyecto (en la terminal) ejecuta (sustituye `TU_USUARIO` por tu usuario de GitHub):

```bash
git remote add origin https://github.com/TU_USUARIO/FaNotes.git
git branch -M main
git push -u origin main
```

## Opción 2: Si usas SSH

```bash
git remote add origin git@github.com:TU_USUARIO/FaNotes.git
git branch -M main
git push -u origin main
```

Después de esto ya puedes conectar **FaNotes** desde GitHub a Railway.
