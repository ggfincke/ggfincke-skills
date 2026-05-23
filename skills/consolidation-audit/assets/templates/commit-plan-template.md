# ==========================================

# <Workstream Name> (<branch>)

# <N> commits — files + first commit line only

# ==========================================

# -----------------------

# Commit 1

# -----------------------

git add \
 <path/to/file1.ts> \
 <path/to/file2.ts>
git commit -m "<type>(<scope>): <description>"

# -----------------------

# Commit 2

# -----------------------

git add \
 <path/to/file3.ts>
git commit -m "<type>(<scope>): <description>"

# -----------------------

# Commit N

# -----------------------

git add \
 <path/to/fileN.ts>

# git rm -f <path/to/deleted.ts> # if deleting files

git commit -m "<type>(<scope>): <description>"
