// Load-test launcher: boots the REAL Express app (all routers) without start()'s
// migration/worker bootstrap. Used for Phase 13 local capacity measurement.
import app from '../../api/server'
const PORT = Number(process.env.PORT ?? 3017)
app.listen(PORT, () => console.log(`LOADTEST_LISTENING ${PORT}`))
